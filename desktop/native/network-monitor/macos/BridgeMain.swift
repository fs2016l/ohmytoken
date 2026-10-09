import Foundation
import NetworkExtension
import SystemExtensions

@main
final class MonitorBridge: NSObject, OSSystemExtensionRequestDelegate {
    private var connection: NSXPCConnection?
    private var timer: DispatchSourceTimer?
    private var manager = NEFilterManager.shared()
    private var parent: ProcessMetadata?
    private var lastPing = monitorNow()
    private var lastPoll = monitorNow()
    private var polling = false
    private var registered = false
    private var stopping = false
    private var allowActivation = false
    private var extensionBundle: Bundle?
    private var attempts = 0

    static func main() {
        if CommandLine.arguments.contains("--list") {
            for row in ProcessMetadata.snapshot(uid: getuid()) {
                if let data = monitorJSON(["type": "processes", "processes": [row.value]]) { write(data) }
            }
            return
        }
        let bridge = MonitorBridge()
        bridge.run()
        withExtendedLifetime(bridge) { RunLoop.main.run() }
    }
    private static func write(_ data: Data) {
        var line = data; line.append(10)
        do { try FileHandle.standardOutput.write(contentsOf: line) } catch { exit(1) }
    }
    private func emit(_ object: [String: Any]) { if let data = monitorJSON(object) { Self.write(data) } }
    private func fail(_ issue: String) { emit(["type": "issue", "issue": issue]); finish() }

    private func run() {
        signal(SIGPIPE, SIG_IGN)
        guard CommandLine.arguments.contains("--monitor"),
              let index = CommandLine.arguments.firstIndex(of: "--parent"), index + 1 < CommandLine.arguments.count,
              let pid = Int32(CommandLine.arguments[index + 1]), pid == getppid(),
              let parent = ProcessMetadata.read(pid), parent.uid == getuid() else { exit(2) }
        self.parent = parent
        allowActivation = CommandLine.arguments.contains("--allow-activation")
        guard let bundle = monitorExtensionBundle() else { fail("extension-required"); return }
        extensionBundle = bundle
        DispatchQueue.global(qos: .utility).async { [weak self] in
            while let line = readLine() {
                guard line.count <= 64 else { break }
                DispatchQueue.main.async {
                    if line == "stop" { self?.finish() }
                    else if line == "ping" { self?.lastPing = monitorNow() }
                }
            }
            DispatchQueue.main.async { self?.finish() }
        }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.resume(); self.timer = timer
        if allowActivation {
            let request = OSSystemExtensionRequest.activationRequest(forExtensionWithIdentifier: "net.ohmytoken.desktop.network-filter", queue: .main)
            request.delegate = self
            OSSystemExtensionManager.shared.submitRequest(request)
        } else { configure() }
    }
    private func configure() {
        manager.loadFromPreferences { [weak self] error in
            DispatchQueue.main.async {
                guard let self = self, !self.stopping else { return }
                guard error == nil else { self.fail("extension-required"); return }
                if !self.allowActivation && self.manager.providerConfiguration == nil { self.fail("permission-required"); return }
                let configuration = self.manager.providerConfiguration ?? NEFilterProviderConfiguration()
                configuration.filterSockets = true; configuration.filterPackets = false
                configuration.filterDataProviderBundleIdentifier = "net.ohmytoken.desktop.network-filter"
                self.manager.providerConfiguration = configuration
                self.manager.localizedDescription = "OhMyToken network usage"
                self.manager.isEnabled = true
                self.manager.saveToPreferences { error in
                    DispatchQueue.main.async {
                        if error != nil { self.fail("permission-denied") } else { self.connect() }
                    }
                }
            }
        }
    }
    private func connect() {
        guard !stopping, let bundle = extensionBundle, let service = monitorMachService(bundle) else { return }
        attempts += 1
        guard attempts <= 30 else { fail("extension-required"); return }
        let connection = NSXPCConnection(machServiceName: service, options: [])
        connection.remoteObjectInterface = NSXPCInterface(with: MonitorProviderControl.self)
        self.connection = connection; connection.resume()
        guard let proxy = connection.remoteObjectProxyWithErrorHandler({ [weak self, weak connection] _ in
            DispatchQueue.main.async {
                guard let self = self, self.connection === connection, !self.stopping else { return }
                // Reconnecting would restart provider counters and hide the
                // gap. Preserve the completed part and require a fresh run.
                if self.registered { self.fail("collector-failed"); return }
                self.connection?.invalidate(); self.connection = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.connect() }
            }
        }) as? MonitorProviderControl else { fail("collector-failed"); return }
        let startedAt = monitorNow()
        proxy.begin { [weak self] accepted in
            DispatchQueue.main.async {
                guard let self = self, !self.stopping else { return }
                if !accepted { self.fail("collector-failed"); return }
                self.registered = true
                self.lastPoll = monitorNow()
                self.poll { self.emit(["type": "ready", "version": 1, "startedAt": startedAt]) }
            }
        }
    }
    private func proxy() -> MonitorProviderControl? {
        connection?.remoteObjectProxyWithErrorHandler { [weak self] _ in
            DispatchQueue.main.async { self?.fail("collector-failed") }
        } as? MonitorProviderControl
    }
    private func poll(_ completion: (() -> Void)? = nil) {
        guard !polling, let proxy = proxy() else { completion?(); return }
        polling = true
        proxy.poll { [weak self] data in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.polling = false; self.lastPoll = monitorNow()
                if data.count > 16 * 1024 * 1024 { self.fail("capacity-reached"); return }
                do { try FileHandle.standardOutput.write(contentsOf: data) } catch { self.finish(); return }
                completion?()
            }
        }
    }
    private func tick() {
        guard !stopping else { return }
        guard let parent = parent, omt_process_matches(parent.pid, parent.born), monitorNow() - lastPing < 10000 else { finish(); return }
        if polling && monitorNow() - lastPoll > 6000 { fail("collector-failed"); return }
        if registered { poll() }
    }
    private func finish() {
        guard !stopping else { return }
        stopping = true; timer?.cancel(); timer = nil
        let disable = {
            self.connection?.invalidate(); self.connection = nil
            self.manager.loadFromPreferences { _ in
                self.manager.isEnabled = false
                self.manager.saveToPreferences { _ in
                    DispatchQueue.main.async { self.emit(["type": "stopped"]); exit(0) }
                }
            }
        }
        if let proxy = proxy(), registered {
            proxy.end { data in
                DispatchQueue.main.async {
                    if data.count <= 16 * 1024 * 1024 {
                        do { try FileHandle.standardOutput.write(contentsOf: data) }
                        catch { exit(1) }
                    } else { self.emit(["type": "issue", "issue": "capacity-reached"]) }
                    disable()
                }
            }
        } else { disable() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { exit(0) }
    }
    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        // Keep the request alive while System Settings waits for approval.
        emit(["type": "issue", "issue": "extension-approval-required"])
    }
    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        if result == .completed { configure() } else { fail("extension-required") }
    }
    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) { fail("extension-required") }
    func request(_ request: OSSystemExtensionRequest, actionForReplacingExtension existing: OSSystemExtensionProperties, withExtension replacement: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction { .replace }
}
