import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? JSONObject ?? [:]
        Task {
            let response = await NativeQueue.shared.run(message["kind"] as? String ?? "", message["payload"] as? JSONObject ?? [:])
            let reply = NSExtensionItem(); reply.userInfo = [SFExtensionMessageKey: response]
            context.completeRequest(returningItems:[reply])
        }
    }
}
