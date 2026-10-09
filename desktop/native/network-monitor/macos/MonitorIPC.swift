import Foundation

@objc protocol MonitorProviderControl {
    func begin(_ reply: @escaping (Bool) -> Void)
    func poll(_ reply: @escaping (Data) -> Void)
    func end(_ reply: @escaping (Data) -> Void)
}

func monitorExtensionBundle() -> Bundle? {
    let root = Bundle.main.bundleURL.appendingPathComponent("Contents/Library/SystemExtensions", isDirectory: true)
    guard let paths = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return nil }
    return paths.compactMap(Bundle.init(url:)).first { $0.bundleIdentifier == "net.ohmytoken.desktop.network-filter" }
}
func monitorMachService(_ bundle: Bundle) -> String? {
    (bundle.object(forInfoDictionaryKey: "NetworkExtension") as? [String: Any])?["NEMachServiceName"] as? String
}
