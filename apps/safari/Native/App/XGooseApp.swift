import SwiftUI
import CoreText
import SafariServices

@main struct XGooseApp: App {
    init() {NativeAppearance.registerFont()}
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup { RootView().environmentObject(model).modifier(NativeAppearanceStyle(settings:model.settings))
            .onOpenURL { url in Task { await model.reload();if url.host == "appearance" {model.appearancePresented=true} } }
            .preferredColorScheme(model.settings["theme"] as? String == "dark" ? .dark : model.settings["theme"] as? String == "light" ? .light : nil)
        }.onChange(of:phase) { _, next in if next == .active { Task { await model.reload() } } }
    }
}

@MainActor final class AppModel: ObservableObject {
    @Published var state: JSONObject = [:]
    @Published var appearancePresented=false
    @Published var error: String?
    @Published var busy = false
    @Published var enabled: Bool?
    @Published var cloud: JSONObject = [:]
    var settings: JSONObject { state["settings"] as? JSONObject ?? [:] }
    var user: JSONObject? { state["user"] as? JSONObject }
    var language: String { settings["language"] as? String ?? "auto" }
    var hosted: Bool { settings["provider"] as? String ?? "xgoose-hosted" == "xgoose-hosted" }
    var connectionReady: Bool { hosted ? user != nil && state["hostedAccepted"] as? Bool == true : state["providerAccepted"] as? Bool == true && (state["configuredProviders"] as? [String] ?? []).contains(settings["provider"] as? String ?? "") }
    func t(_ en:String,_ zh:String,_ es:String? = nil) -> String {
        let selected = language == "auto" ? Locale.preferredLanguages.first ?? "en" : language
        return selected.hasPrefix("zh") ? zh : selected.hasPrefix("es") ? es ?? en : en
    }
    func call(_ kind: String,_ payload: JSONObject = [:],showBusy:Bool = true) async -> Any? {
        if showBusy {busy = true}; defer {if showBusy {busy = false}}
        let result = await NativeQueue.shared.run(kind,payload)
        guard result["ok"] as? Bool == true else { error = result["error"] as? String ?? "Request failed."; return nil }
        return result["value"]
    }
    func reload() async {
        if let view = await call("view",showBusy:state.isEmpty) as? JSONObject { state = view; sampleAppearance() }
        if #available(iOS 26.2, *) {
            do { enabled = try await SFSafariExtensionManager.stateOfExtension(withIdentifier:extensionIdentifier).isEnabled }
            catch { enabled = nil }
        }
    }
    func patch(_ value:JSONObject) async { _ = await call("patch",value); await reload() }
    func settingsPatch(_ value:JSONObject) async { await patch(["settings":value]) }
    @Published var appearanceStatus = ""
    private var appearanceTask:Task<Void,Never>?
    private var appearanceSaved:JSONObject?
    private var appearanceFailed:JSONObject?
    private var appearanceRevision=0
    private var appearanceFlow=UUID().uuidString
    private var appearanceReset=false
    private var appearanceDirty=false
    private var lastAppearanceUsage=""
    private var appearanceActivity:Date = .distantPast
    func appearanceTrack(_ name:String,_ fields:JSONObject=[:]) {
        var params=NativeAppearance(settings:settings).params
        params.merge(fields){_,new in new};params["entry_point"]="native_personalization";params["flow_id"]=appearanceFlow
        Task { _ = await NativeQueue.shared.run("analytics-track",["name":name,"params":params]); await NativeAppearanceTransport.shared.flush() }
    }
    func sampleAppearance() {
        guard settings["analyticsEnabled"] as? Bool == true else {lastAppearanceUsage="";return}
        let params=NativeAppearance(settings:settings).params
        let key=String(data:(try? JSONSerialization.data(withJSONObject:params,options:.sortedKeys)) ?? Data(),encoding:.utf8) ?? ""
        if Date().timeIntervalSince(appearanceActivity)>1800 {lastAppearanceUsage=""}
        appearanceActivity=Date();guard key != lastAppearanceUsage else{return};lastAppearanceUsage=key
        appearanceTrack("appearance_used")
    }
    func openAppearance() {appearanceFlow=UUID().uuidString;if !appearanceDirty {appearanceSaved=["theme":settings["theme"] ?? "system","appearance":settings["appearance"] ?? NativeAppearance.defaults]};appearanceTrack("appearance_opened")}
    func previewAppearance(_ patch:JSONObject,reset:Bool=false) {
        let old:JSONObject=["theme":settings["theme"] ?? "system","appearance":settings["appearance"] ?? NativeAppearance.defaults]
        if appearanceSaved == nil {appearanceSaved=old}
        var next=settings;next.merge(patch){_,new in new}
        let current=NativeAppearance(settings:settings),candidate=NativeAppearance(settings:next)
        guard reset || current != candidate else{return}
        state["settings"]=next;appearanceDirty=true;appearanceRevision += 1;appearanceReset=reset;appearanceStatus="Saving…"
        appearanceTask?.cancel();appearanceTask=Task {do {try await Task.sleep(for:.milliseconds(300))} catch{return};await flushAppearance()}
    }
    func flushAppearance() async {
        appearanceTask?.cancel();appearanceTask=nil;guard appearanceDirty else{return};appearanceDirty=false
        let revision=appearanceRevision,reset=appearanceReset
        let patch:JSONObject=["theme":settings["theme"] ?? "system","appearance":settings["appearance"] ?? NativeAppearance.defaults]
        if !reset {appearanceTrack("appearance_changed")}
        let result=await NativeQueue.shared.run("patch",["settings":patch])
        if result["ok"] as? Bool == true {
            appearanceSaved=patch;appearanceFailed=nil
            if revision==appearanceRevision {appearanceStatus="Saved"}
            appearanceTrack(reset ? "appearance_reset":"appearance_saved",NativeAppearance(settings:patch).params);sampleAppearance()
        } else {
            appearanceFailed=patch;appearanceTrack("appearance_failed",["reason":"storage","outcome":"failed"])
            if revision==appearanceRevision {var saved=settings;saved.merge(appearanceSaved ?? [:]){_,new in new};state["settings"]=saved;appearanceStatus="Could not save. Try again."}
        }
    }
    func retryAppearance() {if let failed=appearanceFailed {previewAppearance(failed)}}
    func openSettings() async {
        if #available(iOS 26.2, *) {
            do { try await SFSafariSettings.openExtensionsSettings(forIdentifiers:[extensionIdentifier]) }
            catch { self.error = error.localizedDescription }
        }
    }
    func loadCloud() async { if let result = await call("cloud") as? JSONObject { cloud = result; await reload() } }
}

struct RootView: View {
    @EnvironmentObject var model:AppModel
    @State private var setupPresented=false
    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing:16) {
                        Image("LargeIcon").resizable().scaledToFit().frame(width:64,height:64).accessibilityHidden(true)
                        VStack(alignment:.leading,spacing:5) { Text("xgoose").font(.largeTitle.bold()); Text(model.t("Your AI, on the page.","你的 AI，就在当前网页。","Tu IA, en la página.")).foregroundStyle(.secondary) }
                    }.padding(.vertical,12)
                }
                Section(model.t("Get ready in Safari","在 Safari 开始使用","Empieza en Safari")) {
                    if model.state["firstAnswerAt"] == nil {Button(model.t("Continue setup","继续首次配置","Continuar configuración")){setupPresented=true}}
                    NavigationLink { LanguageView() } label: { checklist("1",model.t("Choose your language","选择语言","Elige tu idioma"),model.state["languageChosen"] as? Bool == true) }
                    NavigationLink { ConnectionView() } label: { checklist("2",model.t("Connect your AI","连接 AI","Conecta tu IA"),model.connectionReady && model.state["connectionTested"] as? Bool == true) }
                    NavigationLink { EnableView() } label: { checklist("3",model.t("Enable Safari extension","启用 Safari 扩展","Activa la extensión"),model.enabled == true) }
                    NavigationLink { TryView() } label: { checklist("4",model.t("Allow a website & try a chat","授权网站并开始聊天","Autoriza un sitio y prueba el chat"),model.state["firstAnswerAt"] != nil) }
                    if model.state["firstAnswerAt"] != nil { Label(model.t("Your first answer is ready. You're set!","首次回答已完成，可以开始使用了！","Tu primera respuesta está lista."),systemImage:"checkmark.seal.fill").foregroundStyle(.green) }
                }
                Section(model.t("Settings","设置","Ajustes")) {
                    NavigationLink(model.t("Account & Hosted AI","账号与 Hosted AI","Cuenta e IA Hosted")) { AccountView() }
                    NavigationLink(model.t("Built-in website skills","内置网站技能","Habilidades integradas")) { SkillsView() }
                    NavigationLink(model.t("Personalization","个性化","Personalización")) { PersonalizationView() }
                    NavigationLink(model.t("Help & privacy","帮助与隐私","Ayuda y privacidad")) { HelpView() }
                }
            }
            .navigationTitle("xgoose").navigationBarTitleDisplayMode(.inline)
            .modifier(NativeAppearanceStyle(settings:model.settings))
            .alert(model.t("Please try again","请重试","Inténtalo de nuevo"),isPresented:Binding(get:{model.error != nil},set:{if !$0 {model.error=nil}})) { Button("OK") {model.error=nil} } message: {Text(model.error ?? "")}
            .overlay { if model.busy { ProgressView().padding().background(.regularMaterial,in:RoundedRectangle(cornerRadius:16)) } }
            .navigationDestination(isPresented:$model.appearancePresented) {NativeAppearanceView()}
            .task {await model.reload();setupPresented=model.state["dismissed"] as? Bool != true && model.state["firstAnswerAt"] == nil}
            .sheet(isPresented:$setupPresented) {GuidedSetupView()}
        }
    }
    func checklist(_ number:String,_ title:String,_ done:Bool)->some View {
        Label {Text(title)} icon: {Image(systemName:done ? "checkmark.circle.fill":"\(number).circle").foregroundStyle(done ? .green : .secondary)}.padding(.vertical,7)
    }
}

/// Navigation is resumable; only observed connection/answer results complete a step.
struct GuidedSetupView:View {
    @EnvironmentObject var model:AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var step=0
    var canContinue:Bool {
        switch step {
        case 0:return model.state["languageChosen"] as? Bool == true
        case 1:return model.hosted ? model.user != nil : (model.state["configuredProviders"] as? [String] ?? []).contains(model.settings["provider"] as? String ?? "")
        case 2:return model.connectionReady && model.state["connectionTested"] as? Bool == true
        case 3:return true // Moving to website verification does not mark the extension enabled.
        default:return model.state["firstAnswerAt"] != nil
        }
    }
    var body:some View {
        NavigationStack {
            Group {
                switch step {
                case 0:LanguageView()
                case 1:ConnectionView()
                case 2:ConnectionView()
                case 3:EnableView()
                default:TryView()
                }
            }
            .safeAreaInset(edge:.bottom) {
                VStack(spacing:10) {
                    Text(model.t("Step \(step+1) of 5","第 \(step+1) 步，共 5 步","Paso \(step+1) de 5")).font(.footnote).foregroundStyle(.secondary)
                    if step==2 {Text(model.t("Review the model and data use, then test your connection.","确认模型与数据使用说明，然后测试连接。","Revisa el modelo y el uso de datos y prueba la conexión.")).font(.footnote)}
                    Button(step==4 ? model.t("Finish","完成","Finalizar") : model.t("Continue","继续","Continuar")) {
                        if step==4 {dismiss()} else {step+=1}
                    }.buttonStyle(.borderedProminent).disabled(!canContinue)
                    Button(model.t("Set up later","稍后配置","Configurar más tarde")) {Task {await model.patch(["dismissed":true]);dismiss()}}
                }.frame(maxWidth:.infinity).padding().background(.regularMaterial)
            }
            .toolbar {ToolbarItem(placement:.topBarTrailing){Button(model.t("Close","关闭","Cerrar")){Task {await model.patch(["dismissed":true]);dismiss()}}}}
        }
        .onAppear {
            if model.state["languageChosen"] as? Bool == true {step=model.connectionReady && model.state["connectionTested"] as? Bool == true ? 3 : 1}
        }
    }
}

struct LanguageView:View {
    @EnvironmentObject var model:AppModel
    var body:some View { Form {
        Section { ForEach([("auto","Automatic / 跟随系统"),("zh-CN","简体中文"),("en","English"),("es","Español")],id:\.0) { key,label in
            Button { Task {
                var selection:JSONObject=["language":key]
                if model.state["languageChosen"] as? Bool != true {selection["answerLanguage"]=key}
                await model.patch(["settings":selection,"languageChosen":true])
            } } label: { HStack {Text(label);Spacer();if model.language==key {Image(systemName:"checkmark")} } }
        } } footer: { Text(model.t("Your first choice sets both interface and answer language. Later changes here affect only the interface; answer language is in Personalization.","首次选择同时设置界面和回答语言。之后此处只更改界面语言；回答语言可在个性化中调整。","La primera elección configura ambos idiomas. Después, cambia el idioma de respuestas en Personalización.")) }
    }.navigationTitle(model.t("Language","语言","Idioma")) }
}

struct ConnectionView:View {
    @EnvironmentObject var model:AppModel
    @State var key = ""
    @State var base = ""
    @State var selectedModel = ""
    var provider:String {model.settings["provider"] as? String ?? "xgoose-hosted"}
    var body:some View {Form {
        Section(model.t("AI provider","AI 服务","Proveedor de IA")) {
            Picker(model.t("Provider","服务商","Proveedor"),selection:Binding(get:{provider},set:{value in Task {await model.settingsPatch(["provider":value,"model":value == "xgoose-hosted" ? "claude-haiku-5-5":value == "openai-compat" ? "gpt-4o-mini":"gemini-2.5-flash"]); key="";selectedModel=model.settings["model"] as? String ?? "";base=(model.settings["baseUrls"] as? [String:String])?[value] ?? ""}})) {
                Text("xgoose Hosted").tag("xgoose-hosted"); Text("Gemini").tag("gemini"); Text("Gemini via LiteLLM").tag("gemini-litellm"); Text("OpenAI-compatible").tag("openai-compat")
            }
        }
        if model.hosted {
            Section { NavigationLink(model.t("Sign in & review Hosted AI","登录并设置 Hosted AI","Inicia sesión y configura Hosted")) {AccountView()} }
        } else {
            Section(model.t("Your API connection","你的 API 连接","Tu conexión API")) {
                SecureField(model.t("API key (leave empty to keep)","API key（留空则保留）","Clave API"),text:$key).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Base URL",text:$base).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField(model.t("Model ID","模型 ID","ID del modelo"),text:$selectedModel).textInputAutocapitalization(.never).autocorrectionDisabled()
                Text(model.t("Page content, messages and selected images are sent to your chosen AI provider. BYOK conversations are not uploaded to xgoose.","网页内容、消息和所选图片会发送给你选择的 AI 服务商。BYOK 会话默认不上传到 xgoose。","El contenido se envía a tu proveedor. Las conversaciones BYOK no se suben a xgoose.")).font(.footnote).foregroundStyle(.secondary)
                Button(model.t("Agree & save connection","同意并保存连接","Aceptar y guardar")) { Task {
                    var urls=model.settings["baseUrls"] as? [String:String] ?? [:];urls[provider]=base.trimmingCharacters(in:.whitespacesAndNewlines)
                    var patch:JSONObject=["settings":["baseUrls":urls,"model":selectedModel],"providerAccepted":true]
                    if !key.isEmpty {patch["apiKey"]=key}
                    await model.patch(patch);key=""
                }}.disabled(selectedModel.isEmpty)
                Button(model.t("Remove saved API key","删除已保存的 API key","Eliminar clave guardada"),role:.destructive) {Task {await model.patch(["apiKey":"","providerAccepted":false]);key=""}}
            }
        }
        Section {
            Button(model.t("Test connection","测试连接","Probar conexión")) {Task {_ = await model.call("test-connection");await model.reload()}}
            if model.state["connectionTested"] as? Bool == true {Label(model.t("Connection verified","连接已验证","Conexión verificada"),systemImage:"checkmark.circle.fill").foregroundStyle(.green)}
        }
    }.navigationTitle(model.t("Connect AI","连接 AI","Conecta IA"))
     .onAppear {base=(model.settings["baseUrls"] as? [String:String])?[provider] ?? "";selectedModel=model.settings["model"] as? String ?? ""}
    }
}

struct AccountView:View {
    @EnvironmentObject var model:AppModel
    @State var email=""
    @State var confirmDelete=false
    @State var hostedModel=""
    var body:some View {Form {
        if let user=model.user {
            Section(model.t("Signed in","已登录","Sesión iniciada")) { Text(user["email"] as? String ?? "");Button(model.t("Sign out","退出登录","Cerrar sesión"),role:.destructive) {Task {_ = await model.call("logout");await model.reload()}} }
            Section(model.t("Hosted AI","Hosted AI","IA Hosted")) {
                if let quota=model.cloud["quota"] as? JSONObject {Text(model.t("Available credit","可用额度","Crédito disponible")+": "+String(format:"$%.2f",(quota["remaining_micros"] as? Double ?? 0)/1_000_000))}
                if (model.cloud["quota"] as? JSONObject)?["claimable"] as? Bool == true {Button(model.t("Claim trial credit","领取试用额度","Obtener crédito de prueba")) {Task {_ = await model.call("claim-trial");await model.loadCloud()}}}
                let models=model.cloud["models"] as? [JSONObject] ?? []
                if !models.isEmpty {Picker(model.t("Model","模型","Modelo"),selection:Binding(get:{model.hosted ? model.settings["model"] as? String ?? "claude-haiku-5-5" : hostedModel.isEmpty ? (models.first?["id"] as? String ?? "") : hostedModel},set:{id in hostedModel=id;if model.hosted {Task {await model.settingsPatch(["model":id])}}})) {ForEach(models.compactMap{$0["id"] as? String},id:\.self) {Text($0).tag($0)}}}
                Text(model.t("Hosted sends your messages, relevant page content and images to xgoose and its AI providers. Conversations are stored in the cloud and may be accessed by authorized administrators. Use BYOK if you prefer your own provider.","Hosted 会将消息、相关网页内容和图片发送给 xgoose 及其 AI 服务商。会话保存在云端，授权管理员可访问。也可以选择自带 API key。","Hosted envía mensajes, contenido e imágenes a xgoose y sus proveedores. Las conversaciones se guardan en la nube y administradores autorizados pueden acceder."))
                Button(model.state["hostedAccepted"] as? Bool == true ? model.t("Hosted enabled","Hosted 已启用","Hosted activado") : model.t("Agree & use Hosted","同意并使用 Hosted","Aceptar y usar Hosted")) {Task {_ = await model.call("consent",["model":hostedModel]);await model.reload()}}
                Button(model.t("Refresh models & credit","刷新模型与额度","Actualizar modelos y crédito")) {Task {await model.loadCloud()}}
            }
            Section {Button(model.t("Delete account & cloud data","删除账号和云端数据","Eliminar cuenta y datos"),role:.destructive) {confirmDelete=true}}
        } else {
            Section {
                if let pending=model.state["pending"] as? JSONObject {
                    Text(model.t("Check your inbox:","请查看邮箱：","Revisa tu correo:")+" "+(pending["email"] as? String ?? ""))
                    Text(model.t("Confirm the link, then return here. The link expires in 10 minutes.","点击邮件中的确认链接后返回这里。链接有效期为 10 分钟。","Confirma el enlace y vuelve. Caduca en 10 minutos."))
                    Button(model.t("Check confirmation","检查登录状态","Comprobar confirmación")) {Task {_ = await model.call("login-poll");await model.reload()}}
                    Button(model.t("Resend email","重新发送邮件","Reenviar correo")) {Task {_ = await model.call("login-start",["email":pending["email"] ?? ""]);await model.reload()}}
                    Button(model.t("Change email / cancel","更换邮箱 / 取消","Cambiar correo / cancelar")) {Task {_ = await model.call("login-cancel");await model.reload()}}
                } else {
                    TextField(model.t("Email address","邮箱地址","Correo electrónico"),text:$email).keyboardType(.emailAddress).textContentType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button(model.t("Send sign-in email","发送登录邮件","Enviar correo de acceso")) {Task {_ = await model.call("login-start",["email":email]);await model.reload()}}.disabled(!email.contains("@"))
                }
                if let error=model.state["loginError"] as? String {Text(error).foregroundStyle(.red)}
            } header: {Text(model.t("Email confirmation sign-in","邮箱确认登录","Acceso por correo"))} footer: {Text(model.t("New accounts are created when you confirm. No password required. You can also use BYOK without an xgoose account.","确认邮箱时会创建新账号，无需密码。也可以无需 xgoose 账号使用自带 API key。","La cuenta se crea al confirmar. No necesitas contraseña. BYOK no requiere cuenta."))}
        }
    }.navigationTitle(model.t("Account","账号","Cuenta"))
     .task(id:model.user?["id"] as? String) {if model.user != nil {await model.loadCloud()}}
     .task {while !Task.isCancelled {try? await Task.sleep(for:.seconds(5));if Task.isCancelled {break};if model.state["pending"] != nil {await model.reload()}}}
     .confirmationDialog(model.t("Permanently delete your account?","永久删除你的账号？","¿Eliminar tu cuenta permanentemente?"),isPresented:$confirmDelete,titleVisibility:.visible) {Button(model.t("Delete account","删除账号","Eliminar cuenta"),role:.destructive) {Task {_ = await model.call("delete-account");await model.reload()}}} message:{Text(model.t("This removes your account and cloud data, including conversations and published skills. This cannot be undone.","这会删除账号和云端数据，包括会话和已发布技能。此操作无法撤销。","Se eliminarán la cuenta y los datos. No se puede deshacer."))}
    }
}

struct EnableView:View {
    @EnvironmentObject var model:AppModel
    var body:some View {List {
        Section {Image(systemName:"puzzlepiece.extension.fill").font(.system(size:48)).foregroundStyle(.purple).accessibilityHidden(true);Text(model.t("Turn on xgoose in Safari","在 Safari 中启用 xgoose","Activa xgoose en Safari")).font(.title2.bold())}
        if #available(iOS 26.2, *) {Section {Button(model.t("Open extension settings","打开扩展设置","Abrir ajustes de la extensión")) {Task {await model.openSettings()}};Text(model.enabled == true ? model.t("Extension is enabled. Website access is checked separately.","扩展已启用，网站访问权限需要单独验证。","Extensión activada. Comprueba el acceso al sitio.") : model.t("Turn on Allow Extension, then return here.","打开“允许扩展”，然后返回这里。","Activa Permitir extensión y vuelve aquí。"))}}
        Section(model.t("Manual setup","手动启用","Configuración manual")) {
            Text(model.t("1. Open Settings → Apps → Safari → Extensions.","1. 打开设置 → App → Safari → 扩展。","1. Abre Ajustes → Apps → Safari → Extensiones."))
            Text(model.t("2. Select xgoose and turn on Allow Extension.","2. 选择 xgoose，打开“允许扩展”。","2. Selecciona xgoose y activa Permitir extensión."))
            Text(model.t("3. Open a website in Safari. From the page menu, select xgoose and allow access to this website. You may also allow all websites.","3. 在 Safari 打开网站，通过页面菜单选择 xgoose 并允许访问当前网站，也可以允许所有网站。","3. Abre un sitio en Safari, elige xgoose en el menú y permite el acceso."))
            Text(model.t("On iOS 18–26.1, the app verifies website access when the extension runs on a page. Opening Settings does not confirm activation.","iOS 18–26.1 通过扩展在网页中的实际运行验证访问权限。打开设置不会被视为已经启用。","En iOS 18–26.1 verificamos el acceso cuando la extensión se ejecuta en una página.")) .font(.footnote).foregroundStyle(.secondary)
            NavigationLink(model.t("Try it on a website","去网站试用","Pruébalo en un sitio")) {TryView()}
        }
    }.navigationTitle(model.t("Enable extension","启用扩展","Activar extensión"))}
}

struct TryView:View {
    @EnvironmentObject var model:AppModel
    var body:some View {List {
        Section {Text(model.t("Open a website in Safari, allow xgoose from the page menu, then open its chat and ask a question. Website sign-in is separate from your xgoose account.","在 Safari 打开网站，从页面菜单允许 xgoose 访问，再打开聊天提问。网站自身的登录与 xgoose 账号独立。","Abre un sitio en Safari, permite xgoose desde el menú y haz una pregunta. El acceso al sitio es independiente de tu cuenta."))}
        Section {ForEach([("US Card Forum","https://www.uscardforum.com/"),("Reddit","https://www.reddit.com/"),("微博","https://weibo.com/"),("NGA","https://bbs.nga.cn/"),("Hacker News","https://news.ycombinator.com/")],id:\.1) {name,url in Link(destination:URL(string:url)!) {Label(name,systemImage:"arrow.up.right.square")}}}
        Section(model.t("Verification","验证状态","Verificación")) {
            Label(model.t("Extension has run on a website","扩展已在网页上运行","Extensión ejecutada en un sitio"),systemImage:model.state["websiteAvailable"] as? Bool == true ? "checkmark.circle.fill":"circle")
            if let host=model.state["pageHostname"] as? String,!host.isEmpty {Text(model.t("Last verified website: ","最近验证的网站：","Último sitio verificado: ")+host).font(.footnote)}
            if model.state["allWebsites"] as? Bool == true {Text(model.t("Safari reported access to all websites at the last check.","最近一次检查时，Safari 返回了所有网站访问权限。","Safari confirmó acceso a todos los sitios en la última comprobación."))}
            if model.state["websiteAvailable"] as? Bool == false {Text(model.t("Website access changed. Allow xgoose in Safari and reload the page to verify again.","网站访问权限已变化。请在 Safari 重新允许 xgoose，并刷新网页验证。","El acceso cambió. Autoriza xgoose y recarga el sitio.")).foregroundStyle(.orange)}
            if model.state["lastSkillError"] != nil {Text(model.t("Website tools could not start. Check website access, reload the page, and open xgoose again.","网站工具未能启动。请检查网站权限、刷新网页后重新打开 xgoose。","No se pudieron iniciar las herramientas. Revisa el permiso y recarga el sitio.")).foregroundStyle(.orange)}
            Label(model.t("First answer received","已收到首次回答","Primera respuesta recibida"),systemImage:model.state["firstAnswerAt"] == nil ? "circle":"checkmark.circle.fill")
            Text(model.t("Access on one website does not grant access to other websites. If you revoke access, allow it again from Safari’s page menu.","一个网站的授权不代表其他网站也已授权。撤销权限后，可从 Safari 页面菜单重新允许。","El permiso de un sitio no autoriza otros sitios.")) .font(.footnote).foregroundStyle(.secondary)
            Button(model.t("Check again","重新检查","Comprobar de nuevo")) {Task {await model.reload()}}
        }
    }.navigationTitle(model.t("First chat","首次聊天","Primer chat"))}
}

struct SkillsView:View {
    @EnvironmentObject var model:AppModel
    let skills: [JSONObject] = {
        guard let url=Bundle.main.url(forResource:"skills",withExtension:"json"),let data=try? Data(contentsOf:url) else {return []}
        return (try? JSONSerialization.jsonObject(with:data)) as? [JSONObject] ?? []
    }()
    var body:some View {List {
        Section {Text(model.t("Built-in skills adapt xgoose to supported websites. They update with the app.","内置技能让 xgoose 适应支持的网站，随 App 更新。","Las habilidades integradas se actualizan con la app."))}
        ForEach(skills.compactMap{$0["name"] as? String},id:\.self) {name in
            Toggle(name,isOn:Binding(get:{!(model.state["xgoose.skills.disabled"] as? [String] ?? []).contains(name)},set:{enabled in
                Task {await model.patch(["skillToggle":["name":name,"disabled":!enabled]])}
            }))
        }
        if let legacy=model.state["xgoose.skills.user"] as? [JSONObject],!legacy.isEmpty {
            Section(model.t("Previous custom skills","旧自定义技能","Habilidades anteriores")) {
                Text(model.t("Saved for export. Custom scripts are not active in this release.","已保留，可导出。本版不执行自定义脚本。","Conservadas para exportar; no están activas."))
                ShareLink(item:String(data:(try? JSONSerialization.data(withJSONObject:legacy,options:.prettyPrinted)) ?? Data(),encoding:.utf8) ?? "[]") {Text(model.t("Export saved skills","导出已保存技能","Exportar habilidades"))}
            }
        }
    }.navigationTitle(model.t("Website skills","网站技能","Habilidades"))}
}
struct PersonalizationView:View {
    @EnvironmentObject var model:AppModel
    var body:some View {Form {
        NavigationLink(model.t("Interface language","界面语言","Idioma")) {LanguageView()}
        Picker(model.t("Answer language","回答语言","Idioma de respuestas"),selection:Binding(get:{model.settings["answerLanguage"] as? String ?? "auto"},set:{v in Task {await model.settingsPatch(["answerLanguage":v])}})) {ForEach(["auto","zh-CN","en","es"],id:\.self) {Text($0).tag($0)}}
        NavigationLink(model.t("Appearance","外观","Apariencia")) {NativeAppearanceView()}

        Toggle(model.t("Show launcher on all websites","在所有网站显示悬浮按钮","Mostrar botón en todos los sitios"),isOn:Binding(get:{model.settings["launcherVisibility"] as? String == "always"},set:{v in Task {await model.settingsPatch(["launcherVisibility":v ? "always":"skill-sites"])}}))
        Toggle(model.t("Optional usage analytics","可选使用统计","Análisis de uso opcional"),isOn:Binding(get:{model.settings["analyticsEnabled"] as? Bool ?? false},set:{v in Task {await model.settingsPatch(["analyticsEnabled":v])}}))
        Text(model.t("Usage analytics include feature names and error categories, never your messages, email or API keys.","使用统计仅包含功能名称与错误类别，不包含消息、邮箱或 API key。","Las estadísticas no incluyen mensajes, correo ni claves API。")).font(.footnote).foregroundStyle(.secondary)
    }.navigationTitle(model.t("Personalization","个性化","Personalización"))}
}
struct HelpView:View {
    @EnvironmentObject var model:AppModel
    var body:some View {List {
        NavigationLink(model.t("Safari setup guide","Safari 设置指南","Guía de Safari")) {EnableView()}
        Link(model.t("Privacy policy","隐私政策","Política de privacidad"),destination:URL(string:"https://api.xgoose.org/privacy/ios")!)
        Link(model.t("Support","支持","Soporte"),destination:URL(string:"https://xgoose.org/support/")!)
        Text(model.t("Chat runs in the current Safari page. Navigation, refresh or closing the tab ends the run; received content stays in history.","聊天在当前 Safari 网页中运行。导航、刷新或关闭标签页会结束任务；已收到的内容保留在历史中。","La navegación, recarga o cierre finaliza la ejecución. El contenido recibido se conserva."))
        if let archive=model.state["legacyConversations"],JSONSerialization.isValidJSONObject(archive),let data=try? JSONSerialization.data(withJSONObject:archive,options:.prettyPrinted),let text=String(data:data,encoding:.utf8) {
            NavigationLink(model.t("Read previous conversation archive","阅读旧会话存档","Leer conversaciones anteriores")) {
                ScrollView {Text(text).font(.body.monospaced()).textSelection(.enabled).frame(maxWidth:.infinity,alignment:.leading).padding()}
                    .navigationTitle(model.t("Previous conversations (read only)","旧会话（只读）","Conversaciones anteriores"))
            }
            ShareLink(item:text) {Text(model.t("Export previous conversation archive","导出旧会话存档","Exportar conversaciones anteriores"))}
        }
        Text("xgoose 1.6 · Core 0.3.4").foregroundStyle(.secondary)
    }.navigationTitle(model.t("Help & privacy","帮助与隐私","Ayuda y privacidad"))}
}



struct NativeAppearance:Equatable {
    static let presets=["default","glass","notebook","soft","bold"]
    static let fonts=["default","sans","serif","mono"]
    static let defaults:JSONObject=["preset":"default","font":"default","fontScale":1.0]
    static let imported:[String:[String:[String:String]]]=["notebook":["light":["background":"#F9F9F9","foreground":"#3A3A3A","card":"#FFFFFF","muted":"#E3E3E3","muted-foreground":"#505050","primary":"#606060","border":"#747272","input":"#FFFFFF","accent":"#F3EAC8"],"dark":["background":"#2B2B2B","foreground":"#DCDCDC","card":"#333333","muted":"#454545","muted-foreground":"#A0A0A0","primary":"#B0B0B0","border":"#4F4F4F","input":"#333333","accent":"#E0E0E0"]],"soft":["light":["background":"#E7E5E4","foreground":"#1E293B","card":"#F5F5F4","muted":"#E7E5E4","muted-foreground":"#6B7280","primary":"#6366F1","border":"#D6D3D1","input":"#D6D3D1","accent":"#F3E5F5"],"dark":["background":"#1E1B18","foreground":"#E2E8F0","card":"#2C2825","muted":"#1F1C19","muted-foreground":"#9CA3AF","primary":"#818CF8","border":"#3A3633","input":"#3A3633","accent":"#484441"]],"bold":["light":["background":"#FFFFFF","foreground":"#000000","card":"#FFFFFF","muted":"#F0F0F0","muted-foreground":"#333333","primary":"#FF3333","border":"#000000","input":"#000000","accent":"#0066FF"],"dark":["background":"#000000","foreground":"#FFFFFF","card":"#333333","muted":"#1A1A1A","muted-foreground":"#CCCCCC","primary":"#FF6666","border":"#FFFFFF","input":"#FFFFFF","accent":"#3399FF"]]]
    let theme:String,preset:String,font:String
    let scale:Double
    init(settings:JSONObject) {
        let a=settings["appearance"] as? JSONObject ?? [:]
        theme=settings["theme"] as? String ?? "system"
        let p=a["preset"] as? String ?? "default",f=a["font"] as? String ?? "default"
        preset=Self.presets.contains(p) ? p:"default";font=Self.fonts.contains(f) ? f:"default"
        scale=min(1.3,max(0.9,a["fontScale"] as? Double ?? 1))
    }
    var dictionary:JSONObject {["preset":preset,"font":font,"fontScale":scale]}
    var params:JSONObject {["preset":preset,"font":font,"font_scale":scale,"theme":theme,"resolved_theme":theme == "system" ? (nativeDark ? "dark":"light"):theme,"is_customized":theme != "system" || preset != "default" || font != "default" || scale != 1]}
    var radius:CGFloat {preset=="bold" ? 0:preset=="soft" ? 24:preset=="notebook" ? 10:20}
    var border:CGFloat {preset=="bold" ? 3:1}
    func token(_ key:String,dark:Bool)->String {
        if let value=Self.imported[preset]?[dark ? "dark":"light"]?[key] {return value}
        switch key {
        case "background":return dark ? "#101A27":"#EDF3F9"
        case "foreground":return dark ? "#E8F1FA":"#172C3C"
        case "border":return dark ? "#6D8BA5":"#B4C9D9"
        case "primary":return preset=="default" ? "#7352E4":dark ? "#A8C5E5":"#386585"
        default:return dark ? "#192738":"#F6FAFD"
        }
    }
    static func registerFont() {
        guard let data=NSDataAsset(name:"NotebookFont")?.data,let provider=CGDataProvider(data:data as CFData),let font=CGFont(provider) else {return}
        CTFontManagerRegisterGraphicsFont(font,nil)
    }
}
private var nativeDark:Bool {
    #if os(iOS)
    return UITraitCollection.current.userInterfaceStyle == .dark
    #else
    return NSApp.effectiveAppearance.bestMatch(from:[.darkAqua,.aqua]) == .darkAqua
    #endif
}
private func nativeColor(_ hex:String)->Color {
    let value=UInt32(hex.dropFirst(),radix:16) ?? 0x7352E4
    return Color(red:Double((value>>16)&255)/255,green:Double((value>>8)&255)/255,blue:Double(value&255)/255)
}
struct NativeAppearanceStyle:ViewModifier {
    let settings:JSONObject
    @Environment(\.colorScheme) private var mode
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    #if os(macOS)
    @ScaledMetric(relativeTo:.body) private var size:CGFloat=13
    #else
    @ScaledMetric(relativeTo:.body) private var size:CGFloat=17
    #endif
    func body(content:Content)->some View {
        let a=NativeAppearance(settings:settings),dark=mode == .dark
        let design:Font.Design=a.font=="serif" ? .serif:a.font=="mono" ? .monospaced:a.font=="default"&&a.preset=="soft" ? .rounded:.default
        let font:Font=a.font=="default"&&a.preset=="notebook" ? .custom("ArchitectsDaughter-Regular",size:size*a.scale,relativeTo:.body):.system(size:size*a.scale,weight:a.font=="default"&&a.preset=="bold" ? .semibold:.regular,design:design)
        let accent=a.preset=="default" ? Color("AccentColor"):nativeColor(a.token("primary",dark:dark))
        content.font(font).tint(accent).accentColor(accent)
            .scrollContentBackground(a.preset=="default" ? .automatic:.hidden)
            .background {
                if a.preset=="glass" && !reduceTransparency {nativeColor(a.token("background",dark:dark)).opacity(0.25).background(.ultraThinMaterial)}
                else if a.preset != "default" {nativeColor(a.token("background",dark:dark))}
            }
    }
}
struct NativeAppearanceSurface:View {
    let appearance:NativeAppearance
    @Environment(\.colorScheme) private var mode
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var body:some View {
        let a=appearance,dark=mode == .dark
        RoundedRectangle(cornerRadius:a.radius)
            .fill(a.preset=="glass" && !reduceTransparency ? AnyShapeStyle(.ultraThinMaterial):AnyShapeStyle(nativeColor(a.token("card",dark:dark))))
            .overlay(RoundedRectangle(cornerRadius:a.radius).strokeBorder(a.preset=="glass" ? .white.opacity(0.55):nativeColor(a.token("border",dark:dark)),lineWidth:a.border))
            .shadow(color:a.preset=="bold" ? (dark ? .white.opacity(0.7):.black):.black.opacity(a.preset=="soft" ? 0.16:0.06),radius:a.preset=="bold" ? 0:a.preset=="soft" ? 10:5,x:a.preset=="bold" ? 4:a.preset=="soft" ? 6:1,y:a.preset=="bold" ? 4:a.preset=="soft" ? 6:4)
    }
}
struct NativePresetThumbnail:View {
    let preset:String
    @Environment(\.colorScheme) private var mode
    var body:some View {
        let a=NativeAppearance(settings:["appearance":["preset":preset]]),dark=mode == .dark
        VStack(alignment:.leading,spacing:5) {
            Text("xgoose").font(preset=="notebook" ? .custom("ArchitectsDaughter-Regular",size:11):.system(size:10,weight:preset=="bold" ? .black:.medium,design:preset=="soft" ? .rounded:.default))
            Rectangle().fill(nativeColor(a.token("foreground",dark:dark)).opacity(0.2)).frame(width:28,height:2)
            HStack {Spacer();RoundedRectangle(cornerRadius:preset=="bold" ? 0:6).fill(nativeColor(a.token("primary",dark:dark))).frame(width:26,height:8)}
        }.padding(9).frame(width:66,height:58).foregroundStyle(nativeColor(a.token("foreground",dark:dark))).background(NativeAppearanceSurface(appearance:a))
    }
}
struct NativeAppearanceSection<Content:View>:View {
    let title:String
    let appearance:NativeAppearance
    let content:Content
    init(_ title:String,appearance:NativeAppearance,@ViewBuilder content:()->Content) {self.title=title;self.appearance=appearance;self.content=content()}
    var body:some View {VStack(alignment:.leading,spacing:14) {
        if !title.isEmpty {Text(title).font(.headline)}
        content
    }.padding(16).frame(maxWidth:.infinity,alignment:.leading).background(NativeAppearanceSurface(appearance:appearance))}
}
struct NativeAppearanceView:View {
    @EnvironmentObject var model:AppModel
    @Environment(\.scenePhase) private var phase
    private var a:NativeAppearance {NativeAppearance(settings:model.settings)}
    private func update(_ key:String,_ value:Any) {var next=a.dictionary;next[key]=value;model.previewAppearance(["appearance":next])}
    var body:some View {ScrollView {VStack(alignment:.leading,spacing:20) {
        NativeAppearanceSection(model.t("Interface style","界面风格","Estilo de interfaz"),appearance:a) {
            ForEach(Array(NativeAppearance.presets.enumerated()),id:\.element) {index,id in
                Button {update("preset",id)} label: {
                    HStack(spacing:14) {NativePresetThumbnail(preset:id);VStack(alignment:.leading,spacing:4) {
                        Text(model.t(["Classic","Glass","Notebook","Soft","Bold"][index],["经典","磨砂","手帐","软糖","积木"][index]))
                        Text(model.t(["The familiar xgoose interface","Frosted glass and light edges","Paper and handwritten type","Soft surfaces and rounded buttons","Square corners and hard shadows"][index],["熟悉的 xgoose 界面","半透明磨砂与细亮边","纸面、细线与手写字体","柔软立体的表面与圆润按钮","直角、粗边框与硬阴影"][index])).font(.caption).foregroundStyle(.secondary)
                    };Spacer(minLength:4);if a.preset==id {Image(systemName:"checkmark").accessibilityLabel(model.t("Selected","已选择"))}}
                    .padding(.vertical,5).foregroundStyle(.primary)
                }.buttonStyle(.plain).accessibilityIdentifier("appearance-preset-"+id).accessibilityAddTraits(a.preset==id ? .isSelected:[])
            }
        }
        NativeAppearanceSection("",appearance:a) {
            Picker(model.t("Color mode","明暗模式","Modo de color"),selection:Binding(get:{a.theme},set:{model.previewAppearance(["theme":$0])})) {Text(model.t("Follow system","跟随系统","Sistema")).tag("system");Text(model.t("Light","浅色","Claro")).tag("light");Text(model.t("Dark","深色","Oscuro")).tag("dark")}
            Picker(model.t("Font","字体","Tipografía"),selection:Binding(get:{a.font},set:{update("font",$0)})) {ForEach(Array(NativeAppearance.fonts.enumerated()),id:\.element) {index,id in Text(model.t(["Follow preset","Clean sans","Reading serif","Monospace"][index],["跟随预设","简洁黑体","阅读宋体","等宽"][index])).tag(id)}}
            Picker(model.t("Font size","字号","Tamaño"),selection:Binding(get:{a.scale},set:{update("fontScale",$0)})) {ForEach([0.9,1.0,1.15,1.3],id:\.self) {Text("\(Int(($0*100).rounded()))%").tag($0)}}
        }
        NativeAppearanceSection(model.t("Preview","预览","Vista previa"),appearance:a) {
            VStack(alignment:.leading,spacing:12) {
                Text("阅读，思考，再出发。\nRead, think, and keep exploring.")
                TextField(model.t("Your next question","你的下一个问题"),text:.constant("")).textFieldStyle(.roundedBorder).disabled(true)
                Text("const idea = \"xgoose\";").font(.body.monospaced())
                Button(model.t("Preview","预览")) {}.buttonStyle(.borderedProminent)
            }.padding(12).background(NativeAppearanceSurface(appearance:a))
        }
        NativeAppearanceSection("",appearance:a) {
            Button(model.t("Restore appearance defaults","恢复默认外观","Restablecer apariencia")) {model.previewAppearance(["theme":"system","appearance":NativeAppearance.defaults],reset:true)}
            Text(model.t(model.appearanceStatus,["Saving…":"保存中…","Saved":"已保存","Could not save. Try again.":"保存失败，请重试。"][model.appearanceStatus] ?? model.appearanceStatus)).accessibilityAddTraits(.updatesFrequently)
            if model.appearanceStatus == "Could not save. Try again." {Button(model.t("Try again","重试","Reintentar")) {model.retryAppearance()}}
        }
    }.padding(20).pickerStyle(.menu)}.modifier(NativeAppearanceStyle(settings:model.settings)).navigationTitle(model.t("Appearance","外观","Apariencia"))
     .onAppear {model.openAppearance()}
     .onDisappear {Task {await model.flushAppearance()}}
     .onChange(of:phase) {_,next in if next != .active {Task {await model.flushAppearance()}}}
    }
}
