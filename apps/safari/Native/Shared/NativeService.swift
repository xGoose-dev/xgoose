import Foundation
import Security
import Darwin

let appGroup = "group.org.xgoose.xgoose-safari"
let extensionIdentifier = "org.xgoose.xgoose-safari.Extension"
let apiBase = "https://api.xgoose.org"
typealias JSONObject = [String: Any]

struct ServiceError: LocalizedError {
    let message: String
    var status:Int? = nil
    var errorDescription: String? { message }
}

enum Vault {
    static var query: JSONObject {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "org.xgoose.safari.credentials.v2",
         kSecAttrAccount as String: "credentials",
         kSecAttrAccessGroup as String: (Bundle.main.object(forInfoDictionaryKey: "KeychainPrefix") as? String ?? "") + "org.xgoose.xgoose-safari"]
    }
    static func read() throws -> JSONObject {
        var q = query; q[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return [:] }
        guard status == errSecSuccess, let data = result as? Data else { throw ServiceError(message: "Unlock your device to access your AI connection (\(status)).") }
        return try JSONSerialization.jsonObject(with: data) as? JSONObject ?? [:]
    }
    static func write(_ value: JSONObject) throws {
        let data = try JSONSerialization.data(withJSONObject: value)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var q = query; q[kSecValueData as String] = data
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let added = SecItemAdd(q as CFDictionary, nil)
            guard added == errSecSuccess else { throw ServiceError(message: "Could not securely save credentials (\(added)).") }
        } else if status != errSecSuccess { throw ServiceError(message: "Could not securely update credentials (\(status)).") }
    }
}

/// Serializes tasks within each process; the file lock serializes app and extension.
actor NativeQueue {
    static let shared = NativeQueue()
    private var previous: Task<JSONObject, Never>?
    func run(_ kind: String, _ payload: JSONObject = [:]) async -> JSONObject {
        let predecessor = previous
        let next = Task.detached { () -> JSONObject in
            _ = await predecessor?.value
            return await NativeService.handle(kind, payload)
        }
        previous = next
        return await next.value
    }
}

final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){completionHandler(nil)}
}
enum NativeService {
    static var requestSession=URLSession.shared
    static func verifiedLegacyAccount(_ account:JSONObject)->Bool {
        guard let user=account["user"] as? JSONObject else {return false}
        return user["is_anonymous"] as? Bool != true && user["email_verified"] as? Bool == true && (user["email"] as? String ?? "").contains("@")
    }
    static func publicURL(_ raw:String) throws -> URL {
        guard raw.count<=4096,let url=URL(string:raw),url.scheme=="https",url.user==nil,url.password==nil,url.port==nil,
              ["hacker-news.firebaseio.com","hn.algolia.com","sov2ex.com","www.sov2ex.com"].contains(url.host ?? "") else {throw ServiceError(message:"Public API URL is not allowed.")}
        let path=url.path
        let allowed = url.host=="hacker-news.firebaseio.com" ? path.range(of:"^/v0/([a-z]+|item/[0-9]+|user/[A-Za-z0-9_-]+)\\.json$",options:.regularExpression) != nil && url.query==nil : url.host=="hn.algolia.com" ? path.range(of:"^/api/v1/(search|search_by_date|items/[0-9]+)$",options:.regularExpression) != nil : path=="/api/search"
        guard allowed else {throw ServiceError(message:"Public API path is not allowed.")}
        return url
    }
    static var directory: URL { get throws {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {throw ServiceError(message:"Shared storage is unavailable. Please reinstall the signed app.")}
        return url
    }}
    static func load() throws -> JSONObject {
        let path = try directory.appendingPathComponent("state-v2.json")
        guard FileManager.default.fileExists(atPath: path.path) else { return [:] }
        return try JSONSerialization.jsonObject(with: Data(contentsOf: path)) as? JSONObject ?? [:]
    }
    static func save(_ state: inout JSONObject) throws {
        state["revision"] = (state["revision"] as? Int ?? 0) + 1
        let data = try JSONSerialization.data(withJSONObject: state, options: [.sortedKeys])
        try data.write(to: try directory.appendingPathComponent("state-v2.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    static func migrate(_ supplied: JSONObject, state: inout JSONObject) throws {
        var vault = try Vault.read()
        let defaults = UserDefaults(suiteName: appGroup)!
        if state["settings"] == nil {
            var settings: JSONObject = ["provider":"xgoose-hosted", "model":"claude-haiku-5-5", "thinking":false,"language":"auto","answerLanguage":"auto","theme":"system","launcherVisibility":"skill-sites","analyticsEnabled":false]
            for key in ["xgoose.settings","xgoose.account","xgoose.skills.disabled","xgoose.skills.user","xgoose.layout"] {
                var value: Any? = defaults.object(forKey: key)
                if let raw = value as? String, let data = raw.data(using: .utf8) { value = try? JSONSerialization.jsonObject(with: data) }
                if key == "xgoose.settings", let old = value as? JSONObject { settings.merge(old) { _, new in new };if old["language"] != nil {state["languageChosen"]=true} }
                else if key == "xgoose.account", let account = value as? JSONObject {
                    if verifiedLegacyAccount(account) {vault["account"]=account}
                    else {vault["legacyAccount"]=account}
                }
                else if let value { state[key] = value }
            }
            settings["analyticsEnabled"] = false
            state["settings"] = settings
        }
        if state["extensionMigrated"] as? Bool != true, !supplied.isEmpty {
            // A fresh extension has no legacy values; never overwrite app-side setup with an empty mirror.
            if let old = supplied["xgoose.settings"] as? JSONObject, state["configured"] as? Bool != true {
                var settings = state["settings"] as? JSONObject ?? [:]
                settings.merge(old) { _, new in new }; settings["analyticsEnabled"] = false
                state["settings"] = settings
            }
            if let old=supplied["xgoose.settings"] as? JSONObject {
                var saved=vault["apiKeys"] as? [String:String] ?? [:]
                for (provider,key) in old["apiKeys"] as? [String:String] ?? [:] where saved[provider]?.isEmpty != false {saved[provider]=key}
                if let key=old["apiKey"] as? String,!key.isEmpty,let provider=old["provider"] as? String,saved[provider]?.isEmpty != false {saved[provider]=key}
                vault["apiKeys"]=saved
                if old["language"] != nil {state["languageChosen"]=true}
            }
            if let old = supplied["xgoose.account"] as? JSONObject {
                if vault["account"] == nil,verifiedLegacyAccount(old) {vault["account"]=old}
                else if !verifiedLegacyAccount(old) {vault["legacyAccount"]=old}
            }
            for key in ["xgoose.skills.disabled","xgoose.skills.user","xgoose.layout"] where supplied[key] != nil && state[key] == nil { state[key] = supplied[key] }
            state["extensionMigrated"] = true
        }
        var settings = state["settings"] as? JSONObject ?? [:]
        if let old=state.removeValue(forKey:"xgoose.account") as? JSONObject {vault["legacyAccount"]=old}
        var keys = vault["apiKeys"] as? [String:String] ?? [:]
        if let old = settings["apiKeys"] as? [String:String] { keys.merge(old) { existing, next in existing.isEmpty ? next : existing } }
        if let key = settings["apiKey"] as? String, !key.isEmpty, let provider = settings["provider"] as? String, keys[provider] == nil { keys[provider] = key }
        if let provider=settings["provider"] as? String,let url=settings["baseUrl"] as? String,!url.isEmpty {
            var urls=settings["baseUrls"] as? [String:String] ?? [:];if urls[provider]==nil {urls[provider]=url};settings["baseUrls"]=urls
        }
        if let conversations=supplied["xgoose.conversations"],state["legacyConversations"]==nil {state["legacyConversations"]=conversations}
        vault["apiKeys"] = keys
        settings.removeValue(forKey:"apiKeys"); settings.removeValue(forKey:"apiKey"); state["settings"] = settings
        try Vault.write(vault)
        // Delete legacy secret-bearing records only after the vault write succeeds.
        if let data = try? JSONSerialization.data(withJSONObject: settings), let json = String(data:data,encoding:.utf8) { defaults.set(json,forKey:"xgoose.settings") }
        defaults.removeObject(forKey:"xgoose.account")
    }
    static func request(_ path: String, method: String = "GET", body: JSONObject? = nil, bearer: String? = nil) async throws -> JSONObject {
        var request = URLRequest(url: URL(string:apiBase + path)!)
        request.httpMethod = method; request.timeoutInterval = 45
        request.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if let bearer { request.setValue("Bearer \(bearer)",forHTTPHeaderField:"Authorization") }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data,response) = try await requestSession.data(for:request)
        let result = (try? JSONSerialization.jsonObject(with:data)) as? JSONObject ?? [:]
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let error = (result["error"] as? JSONObject)?["message"] as? String ?? result["message"] as? String ?? result["error"] as? String ?? "Request failed (HTTP \(code))."
            throw ServiceError(message:error,status:code)
        }
        return result
    }
    static func freshAccount(_ force: Bool = false) async throws -> JSONObject? {
        var vault = try Vault.read()
        guard var account = vault["account"] as? JSONObject else { return nil }
        let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
        let expires = account["accessTokenExpiresAt"] as? String ?? ""
        let date = format.date(from:expires) ?? ISO8601DateFormatter().date(from:expires) ?? .distantPast
        if !force && date.timeIntervalSinceNow > 60 { return account }
        let tokens:JSONObject
        do {tokens = try await request("/auth/refresh",method:"POST",body:["refresh_token":account["refreshToken"] ?? ""])}
        catch {if let failure=error as? ServiceError,[401,403].contains(failure.status ?? 0) {vault.removeValue(forKey:"account");try Vault.write(vault);throw ServiceError(message:"Your session expired. Sign in with email again.")};throw error}
        account["accessToken"] = tokens["access_token"]; account["refreshToken"] = tokens["refresh_token"]
        account["accessTokenExpiresAt"] = tokens["access_token_expires_at"]
        vault["account"] = account; try Vault.write(vault)
        return account
    }
    static func poll(state: inout JSONObject) async throws {
        var vault = try Vault.read()
        guard let pending = vault["pending"] as? JSONObject else { return }
        guard (pending["expiresAt"] as? Double ?? 0) > Date().timeIntervalSince1970 * 1000 else {
            vault.removeValue(forKey:"pending"); try Vault.write(vault); state["loginError"] = "Sign-in expired. Request a new email."; return
        }
        let tokens = try await request("/auth/extension/poll",method:"POST",body:["token":pending["token"] ?? ""])
        guard tokens["status"] as? String == "ok" else { return }
        vault["account"] = ["user":tokens["user"] ?? [:],"accessToken":tokens["access_token"] ?? "","refreshToken":tokens["refresh_token"] ?? "","accessTokenExpiresAt":tokens["access_token_expires_at"] ?? "","lastSeenAt":Date().timeIntervalSince1970 * 1000]
        vault.removeValue(forKey:"pending"); try Vault.write(vault); state.removeValue(forKey:"loginError")
        state.removeValue(forKey:"hostedAccepted"); state.removeValue(forKey:"connectionTested")
    }
    static func handle(_ kind: String, _ payload: JSONObject) async -> JSONObject {
        guard let directory = try? directory else {return ["ok":false,"error":"Shared storage is unavailable. Check the app signature."]}
        let fd = open(directory.appendingPathComponent("native.lock").path,O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { return ["ok":false,"error":"Shared storage unavailable."] }
        guard flock(fd,LOCK_EX) == 0 else { close(fd); return ["ok":false,"error":"Could not lock shared storage."] }
        defer { flock(fd,LOCK_UN); close(fd) }
        do {
            var state = try load()
            let originalState = try JSONSerialization.data(withJSONObject:state,options:.sortedKeys)
            try migrate(kind == "migrate" ? payload : [:],state:&state)
            var value: Any = NSNull()
            switch kind {
            case "snapshot", "migrate":
                var settings = state["settings"] as? JSONObject ?? [:]
                settings["nativeConfiguredProviders"] = Array((try Vault.read()["apiKeys"] as? [String:String] ?? [:]).filter{!$0.value.isEmpty}.keys)
                value = ["revision":state["revision"] ?? 0,"migrated":true,"values":["xgoose.settings":settings,"xgoose.skills.disabled":state["xgoose.skills.disabled"] ?? [],"xgoose.skills.user":[],"xgoose.layout":state["xgoose.layout"] ?? [:]]]
            case "view":
                do {try await poll(state:&state)} catch {
                    if let failure=error as? ServiceError,[401,403].contains(failure.status ?? 0) {var vault=try Vault.read();vault.removeValue(forKey:"pending");try Vault.write(vault);state["loginError"]=failure.message}
                    else {state["loginError"]="Connection interrupted. Confirmation will be checked again when you return."}
                }
                var view = state
                let vault = try Vault.read()
                if let account = vault["account"] as? JSONObject { view["user"] = account["user"] }
                if let pending = vault["pending"] as? JSONObject { view["pending"] = ["email":pending["email"] ?? "","expiresAt":pending["expiresAt"] ?? 0] }
                view["configuredProviders"] = Array((vault["apiKeys"] as? [String:String] ?? [:]).filter{!$0.value.isEmpty}.keys)
                value = view
            case "patch":
                // Field patches avoid overwriting unrelated changes made by the extension.
                var settings = state["settings"] as? JSONObject ?? [:]
                let allowed = Set(["provider","model","thinking","language","answerLanguage","theme","launcherVisibility","analyticsEnabled","baseUrls"])
                if let patch=payload["settings"] as? JSONObject,let provider=patch["provider"] as? String,provider != settings["provider"] as? String {state.removeValue(forKey:"providerAccepted")}
                if let patch = payload["settings"] as? JSONObject { for (key,item) in patch where allowed.contains(key) { settings[key] = item } }
                if let key = payload["apiKey"] as? String, let provider = settings["provider"] as? String {
                    var vault = try Vault.read(); var keys = vault["apiKeys"] as? [String:String] ?? [:]; keys[provider] = key; vault["apiKeys"] = keys; try Vault.write(vault)
                }
                if let patch=payload["settings"] as? JSONObject, patch.keys.contains(where:{["provider","model","baseUrls"].contains($0)}) || payload["apiKey"] != nil {state.removeValue(forKey:"connectionTested")}
                state["settings"] = settings; state["configured"] = true
                for key in ["hostedAccepted","providerAccepted","languageChosen","dismissed","connectionTested"] { if let item = payload[key] { state[key] = item } }
                if let disabled = payload["disabledSkills"] as? [String] { state["xgoose.skills.disabled"] = disabled }
                if let toggle=payload["skillToggle"] as? JSONObject,let name=toggle["name"] as? String,let disabled=toggle["disabled"] as? Bool {
                    var names=Set(state["xgoose.skills.disabled"] as? [String] ?? []);if disabled {names.insert(name)} else {names.remove(name)};state["xgoose.skills.disabled"]=Array(names).sorted()
                }
                if let layout=payload["layout"] as? JSONObject {state["xgoose.layout"]=layout}
            case "hosted-ready":
                guard state["hostedAccepted"] as? Bool == true else {throw ServiceError(message:"Open xgoose and agree to Hosted data use first.")}
            case "credentials":
                guard state["providerAccepted"] as? Bool == true else {throw ServiceError(message:"Open xgoose and agree to your provider’s data use first.")}
                let vault = try Vault.read(); value = ["apiKey":(vault["apiKeys"] as? [String:String])?[payload["provider"] as? String ?? ""] ?? ""]
            case "account": value = try await freshAccount(payload["refresh"] as? Bool ?? false) as Any? ?? NSNull()
            case "login-start":
                guard let email = payload["email"] as? String, email.contains("@") else { throw ServiceError(message:"Enter a valid email address.") }
                let normalized = email.trimmingCharacters(in:.whitespacesAndNewlines).lowercased()
                let result = try await request("/auth/extension/request",method:"POST",body:["email":normalized,"client":"ios"])
                var vault = try Vault.read(); vault["pending"] = ["email":normalized,"token":result["poll_token"] ?? "","expiresAt":Date().timeIntervalSince1970 * 1000 + (result["expires_in"] as? Double ?? 600) * 1000]
                try Vault.write(vault); state.removeValue(forKey:"loginError")
            case "login-cancel": var vault = try Vault.read(); vault.removeValue(forKey:"pending"); try Vault.write(vault)
            case "login-poll": try await poll(state:&state)
            case "login-state":
                let vault = try Vault.read(); let pending = vault["pending"] as? JSONObject
                value = ["phase":pending == nil ? "idle":"pending","email":pending?["email"] ?? NSNull(),"verificationUri":NSNull(),"expiresAt":pending?["expiresAt"] ?? NSNull(),"error":state["loginError"] ?? NSNull()]
            case "logout":
                var vault = try Vault.read()
                if let account = vault["account"] as? JSONObject { _ = try? await request("/auth/logout",method:"POST",body:["refresh_token":account["refreshToken"] ?? ""]) }
                vault.removeValue(forKey:"account"); vault.removeValue(forKey:"pending"); try Vault.write(vault)
                state.removeValue(forKey:"hostedAccepted"); state.removeValue(forKey:"connectionTested")
            case "test-connection":
                let settings=state["settings"] as? JSONObject ?? [:]
                let provider=settings["provider"] as? String ?? "xgoose-hosted"
                if provider == "xgoose-hosted" {
                    guard state["hostedAccepted"] as? Bool == true, let account=try await freshAccount(),let token=account["accessToken"] as? String else {throw ServiceError(message:"Sign in and agree to Hosted data use first.")}
                    _ = try await request("/ai/v1/chat/completions",method:"POST",body:["model":settings["model"] ?? "claude-haiku-5-5","messages":[["role":"user","content":"Reply with OK."]],"max_tokens":16,"stream":false],bearer:token)
                } else {
                    let vault=try Vault.read()
                    guard state["providerAccepted"] as? Bool == true,let key=(vault["apiKeys"] as? [String:String])?[provider],!key.isEmpty else {throw ServiceError(message:"Save your API key and agree to provider data use first.")}
                    let base=(settings["baseUrls"] as? [String:String])?[provider] ?? ""
                    var root=base.trimmingCharacters(in:CharacterSet(charactersIn:"/"))
                    if root.isEmpty {root=provider == "gemini" ? "https://generativelanguage.googleapis.com/v1beta":"https://api.openai.com/v1"}
                    if provider == "gemini" || provider == "gemini-litellm" {if !root.hasSuffix("/v1beta") && !root.hasSuffix("/v1") {root += "/v1beta"}}
                    else if !root.hasSuffix("/v1") {root += "/v1"}
                    guard let url=URL(string:root+"/models"),url.scheme=="https" else {throw ServiceError(message:"Use an HTTPS API base URL.")}
                    var req=URLRequest(url:url);req.timeoutInterval=20
                    req.setValue(provider == "openai-compat" ? "Bearer \(key)":key,forHTTPHeaderField:provider == "openai-compat" ? "Authorization":"x-goog-api-key")
                    let (_,res)=try await URLSession.shared.data(for:req)
                    guard let status=(res as? HTTPURLResponse)?.statusCode,(200..<300).contains(status) else {throw ServiceError(message:"The provider rejected the connection. Check your key and base URL.")}
                }
                state["connectionTested"] = true
            case "public-read":
                let url=try publicURL(payload["url"] as? String ?? "")
                var req=URLRequest(url:url);req.timeoutInterval=17;req.httpMethod="GET"
                let config=URLSessionConfiguration.ephemeral;config.httpShouldSetCookies=false;config.httpCookieStorage=nil;config.urlCache=nil
                let session=URLSession(configuration:config,delegate:NoRedirect(),delegateQueue:nil)
                defer {session.invalidateAndCancel()}
                let (data,res)=try await session.data(for:req)
                guard data.count<=2_000_000,let http=res as? HTTPURLResponse,(200...599).contains(http.statusCode) else {throw ServiceError(message:"Public API response is too large or invalid.")}
                var headers:[String:String]=[:]
                for field in ["content-type","retry-after","x-rate-limit-reset","x-rate-limit-remaining"] {if let value=http.value(forHTTPHeaderField:field){headers[field]=value}}
                value=["body":String(decoding:data,as:UTF8.self),"status":http.statusCode,"headers":headers]
            case "cloud":
                guard let account = try await freshAccount(), let token = account["accessToken"] as? String else { throw ServiceError(message:"Sign in with email first.") }
                let models = try await request("/ai/v1/models",bearer:token)
                let quota = try await request("/me/quota",bearer:token)
                let ids=(models["data"] as? [JSONObject] ?? []).compactMap{$0["id"] as? String}
                var settings=state["settings"] as? JSONObject ?? [:]
                if settings["provider"] as? String == "xgoose-hosted",let first=ids.first,!ids.contains(settings["model"] as? String ?? "") {settings["model"]=first;state["settings"]=settings;state.removeValue(forKey:"connectionTested")}
                value = ["models":models["data"] ?? [],"quota":quota]
            case "claim-trial":
                guard let account=try await freshAccount(),let token=account["accessToken"] as? String else {throw ServiceError(message:"Sign in first.")}
                value=try await request("/me/trial/claim",method:"POST",bearer:token)
            case "consent":
                guard let account = try await freshAccount(), let token = account["accessToken"] as? String else { throw ServiceError(message:"Sign in with email first.") }
                _ = try await request("/me/transcript-consent",method:"PUT",body:["hosted":true,"byok":false],bearer:token)
                let catalog=try await request("/ai/v1/models",bearer:token)
                let ids=(catalog["data"] as? [JSONObject] ?? []).compactMap{$0["id"] as? String}
                guard let first=ids.first else {throw ServiceError(message:"Hosted has no available models. Try again later or use BYOK.")}
                var settings=state["settings"] as? JSONObject ?? [:]
                let requested=payload["model"] as? String ?? ""
                if ids.contains(requested) {settings["model"]=requested;state.removeValue(forKey:"connectionTested")}
                else if settings["provider"] as? String != "xgoose-hosted" || !ids.contains(settings["model"] as? String ?? "") {settings["model"]=ids.contains("claude-haiku-5-5") ? "claude-haiku-5-5":first;state.removeValue(forKey:"connectionTested")}
                settings["provider"]="xgoose-hosted";state["settings"]=settings
                state["hostedAccepted"] = true
            case "progress":
                if payload["kind"] as? String == "diagnostic",let error=payload["error"] as? String {state["lastSkillError"]=String(error.prefix(300))}
                if payload["kind"] as? String == "page" { state["pageSeenAt"] = Date().timeIntervalSince1970;state["websiteAvailable"]=true;state["pageHostname"]=payload["hostname"] ?? "";state["allWebsites"]=payload["allWebsites"] as? Bool ?? false;state.removeValue(forKey:"lastSkillError") }
                if payload["kind"] as? String == "answer",state["firstAnswerAt"] == nil { state["firstAnswerAt"] = Date().timeIntervalSince1970 }
            case "permissions-removed":state["websiteAvailable"]=false;state["allWebsites"]=false
            case "delete-account":
                guard let account = try await freshAccount(), let token = account["accessToken"] as? String else { throw ServiceError(message:"Sign in first.") }
                _ = try await request("/me/account",method:"DELETE",bearer:token)
                var vault = try Vault.read(); vault.removeValue(forKey:"account"); vault.removeValue(forKey:"pending"); try Vault.write(vault)
                state.removeValue(forKey:"hostedAccepted"); state.removeValue(forKey:"connectionTested")
            case "legacy-export": value = state["xgoose.skills.user"] ?? []
            default: throw ServiceError(message:"Unknown native operation.")
            }
            if originalState != (try JSONSerialization.data(withJSONObject:state,options:.sortedKeys)) { try save(&state) }
            if kind == "snapshot" || kind == "migrate", var snapshot = value as? JSONObject {snapshot["revision"] = state["revision"] ?? 0;value=snapshot}
            return ["ok":true,"value":value]
        } catch { return ["ok":false,"error":error.localizedDescription] }
    }
}
