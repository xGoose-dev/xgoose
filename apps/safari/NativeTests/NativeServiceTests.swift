import XCTest
@testable import xgoose

final class NativeServiceTests:XCTestCase {
    var legacyDefaults:[String:Any] = [:]
    var original:Data?
    var secrets:JSONObject = [:]
    override func setUpWithError() throws {
        let path=try NativeService.directory.appendingPathComponent("state-v2.json")
        original=try? Data(contentsOf:path);secrets=try Vault.read()
        let defaults=UserDefaults(suiteName:appGroup)!
        for key in ["xgoose.settings","xgoose.account"] {if let value=defaults.object(forKey:key){legacyDefaults[key]=value}}
        try? FileManager.default.removeItem(at:path);try Vault.write([:])
    }
    override func tearDownWithError() throws {
        let path=try NativeService.directory.appendingPathComponent("state-v2.json")
        if let original {try original.write(to:path,options:.atomic)} else {try? FileManager.default.removeItem(at:path)}
        try Vault.write(secrets)
        NativeService.requestSession=URLSession.shared
        let defaults=UserDefaults(suiteName:appGroup)!
        for key in ["xgoose.settings","xgoose.account"] {if let value=legacyDefaults[key]{defaults.set(value,forKey:key)}else{defaults.removeObject(forKey:key)}}
    }
    func testPublicReaderRejectsPrivateHostsCredentialsAndPaths() throws {
        XCTAssertNoThrow(try NativeService.publicURL("https://hacker-news.firebaseio.com/v0/topstories.json"))
        for raw in ["http://hn.algolia.com/api/v1/search","https://localhost/api/v1/search","https://user@hn.algolia.com/api/v1/search","https://hn.algolia.com:8443/api/v1/search","https://hn.algolia.com/admin"] {XCTAssertThrowsError(try NativeService.publicURL(raw))}
    }
    func testSnapshotIsStableAndCredentialsStayInKeychain() async throws {
        let migrated=await NativeQueue.shared.run("migrate",["xgoose.settings":["provider":"openai-compat","model":"test","apiKey":"synthetic-secret"],"xgoose.skills.user":[["name":"legacy","source":"synthetic"]]])
        XCTAssertEqual(migrated["ok"] as? Bool,true)
        let first=await NativeQueue.shared.run("snapshot"),second=await NativeQueue.shared.run("snapshot")
        let a=first["value"] as? JSONObject,b=second["value"] as? JSONObject
        XCTAssertEqual(a?["revision"] as? Int,b?["revision"] as? Int)
        let encoded=String(data:try JSONSerialization.data(withJSONObject:first),encoding:.utf8)!
        XCTAssertFalse(encoded.contains("synthetic-secret"))
        XCTAssertEqual((try Vault.read()["apiKeys"] as? [String:String])?["openai-compat"],"synthetic-secret")
        let archive=await NativeQueue.shared.run("legacy-export")
        XCTAssertEqual((archive["value"] as? [JSONObject])?.first?["name"] as? String,"legacy")
    }
    func testConcurrentPatchesPreserveIndependentSettingsAndProgress() async throws {
        async let language=NativeQueue.shared.run("patch",["settings":["language":"zh-CN"]])
        async let theme=NativeQueue.shared.run("patch",["settings":["theme":"dark"]])
        async let hn=NativeQueue.shared.run("patch",["skillToggle":["name":"hacker-news","disabled":true]])
        async let forum=NativeQueue.shared.run("patch",["skillToggle":["name":"discourse-forum","disabled":true]])
        _ = await (language,theme,hn,forum)
        _ = await NativeQueue.shared.run("progress",["kind":"page"])
        let response=await NativeQueue.shared.run("view"),view=response["value"] as? JSONObject
        let settings=view?["settings"] as? JSONObject
        XCTAssertEqual(settings?["language"] as? String,"zh-CN")
        XCTAssertEqual(settings?["theme"] as? String,"dark")
        XCTAssertNotNil(view?["pageSeenAt"]);XCTAssertNil(view?["firstAnswerAt"])
        XCTAssertEqual(Set(view?["xgoose.skills.disabled"] as? [String] ?? []),Set(["hacker-news","discourse-forum"]))
    }
    func testCredentialAccessNeedsExplicitProviderAcceptance() async throws {
        _ = await NativeQueue.shared.run("snapshot")
        let denied=await NativeQueue.shared.run("credentials",["provider":"gemini"])
        XCTAssertEqual(denied["ok"] as? Bool,false)
        _ = await NativeQueue.shared.run("patch",["settings":["provider":"gemini"],"apiKey":"synthetic-key","providerAccepted":true])
        let allowed=await NativeQueue.shared.run("credentials",["provider":"gemini"])
        XCTAssertEqual((allowed["value"] as? JSONObject)?["apiKey"] as? String,"synthetic-key")
        _ = await NativeQueue.shared.run("patch",["settings":["provider":"openai-compat"]])
        let switched=await NativeQueue.shared.run("credentials",["provider":"gemini"])
        XCTAssertEqual(switched["ok"] as? Bool,false,"A different provider requires its own data-use acceptance")
    }
    func testLegacyUpgradeRetainsKeysAndArchiveWithoutResurrectingSignedOutAccount() async throws {
        _ = await NativeQueue.shared.run("patch",["settings":["language":"es","theme":"dark"]])
        let legacy:JSONObject=["xgoose.settings":["provider":"gemini","apiKey":"legacy-test-key","language":"zh-CN"],"xgoose.account":["user":["id":"anonymous","is_anonymous":true]],"xgoose.conversations":[["id":"v1.5","messages":[]]],"xgoose.skills.user":[["name":"v1.6","source":"retained"]]]
        _ = await NativeQueue.shared.run("migrate",legacy)
        let view=(await NativeQueue.shared.run("view"))["value"] as? JSONObject
        XCTAssertEqual((view?["settings"] as? JSONObject)?["language"] as? String,"es")
        XCTAssertNotNil(view?["legacyConversations"]);XCTAssertNil(view?["user"])
        XCTAssertEqual((try Vault.read()["apiKeys"] as? [String:String])?["gemini"],"legacy-test-key")
        _ = await NativeQueue.shared.run("logout")
        _ = await NativeQueue.shared.run("migrate",["xgoose.account":["user":["id":"old-real","is_anonymous":false]]])
        XCTAssertNil(try Vault.read()["account"])
    }
    func testAnonymousUpgradeDoesNotPersistPlaintextTokensOrSignIn() async throws {
        let defaults=UserDefaults(suiteName:appGroup)!
        defaults.set("{\"user\":{\"email\":\"\",\"is_anonymous\":true},\"refreshToken\":\"anonymous-test-secret\"}",forKey:"xgoose.account")
        let result=await NativeQueue.shared.run("view")
        let encoded=String(data:try JSONSerialization.data(withJSONObject:result),encoding:.utf8)!
        XCTAssertFalse(encoded.contains("anonymous-test-secret"));XCTAssertNil((result["value"] as? JSONObject)?["user"])
        XCTAssertEqual((try Vault.read()["legacyAccount"] as? JSONObject)?["refreshToken"] as? String,"anonymous-test-secret")
        XCTAssertFalse(String(data:try Data(contentsOf:NativeService.directory.appendingPathComponent("state-v2.json")),encoding:.utf8)!.contains("anonymous-test-secret"))
    }
    func testConcurrentRefreshUsesEachRotatedTokenExactlyOnce() async throws {
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[RefreshProtocol.self]
        NativeService.requestSession=URLSession(configuration:config)
        RefreshProtocol.next=0
        try Vault.write(["account":["user":["id":"test-user"],"refreshToken":"refresh-0","accessToken":"expired","accessTokenExpiresAt":"2000-01-01T00:00:00Z"]])
        async let app=NativeQueue.shared.run("account",["refresh":true])
        async let ext=NativeQueue.shared.run("account",["refresh":true])
        let values=await [app,ext]
        XCTAssertTrue(values.allSatisfy{$0["ok"] as? Bool == true})
        XCTAssertEqual(RefreshProtocol.next,2)
        XCTAssertEqual((try Vault.read()["account"] as? JSONObject)?["refreshToken"] as? String,"refresh-2")
    }
}

final class RefreshProtocol:URLProtocol {
    static var next=0
    override class func canInit(with request:URLRequest)->Bool {true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest {request}
    override func startLoading() {
        var data=request.httpBody ?? Data()
        if data.isEmpty,let stream=request.httpBodyStream {stream.open();defer{stream.close()};var bytes=[UInt8](repeating:0,count:4096);while stream.hasBytesAvailable {let count=stream.read(&bytes,maxLength:bytes.count);if count<=0 {break};data.append(contentsOf:bytes.prefix(count))}}
        let body=(try? JSONSerialization.jsonObject(with:data)) as? JSONObject
        let valid=body?["refresh_token"] as? String == "refresh-\(Self.next)"
        if valid {Self.next+=1}
        let value:JSONObject=valid ? ["access_token":"access-\(Self.next)","refresh_token":"refresh-\(Self.next)","access_token_expires_at":"2099-01-01T00:00:00Z"]:["message":"Refresh token was reused"]
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:valid ? 200:401,httpVersion:nil,headerFields:["content-type":"application/json"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:try! JSONSerialization.data(withJSONObject:value));client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
