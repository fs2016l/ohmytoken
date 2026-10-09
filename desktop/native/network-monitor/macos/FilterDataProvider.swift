import Foundation
import Network
import NetworkExtension
import Security

final class MonitorEndpoint {
    let process: String
    let local: String
    let remote: String
    let localPort: Int
    let remotePort: Int
    let transport: String
    var responsibleKey: String?
    init?(flow: NEFilterSocketFlow, process: String) {
        guard let local = flow.localEndpoint as? NWHostEndpoint,
              let remote = flow.remoteEndpoint as? NWHostEndpoint,
              let localPort = Int(local.port), let remotePort = Int(remote.port),
              [Int32(IPPROTO_TCP), Int32(IPPROTO_UDP)].contains(flow.socketProtocol) else { return nil }
        self.process = process; self.local = local.hostname; self.remote = remote.hostname
        self.localPort = localPort; self.remotePort = remotePort
        self.transport = flow.socketProtocol == Int32(IPPROTO_TCP) ? "tcp" : "udp"
    }
}

final class FilterDataProvider: NEFilterDataProvider, NSXPCListenerDelegate {
    private let stateQueue = DispatchQueue(label: "net.ohmytoken.monitor.state")
    private var listener: NSXPCListener?
    private var connection: NSXPCConnection?
    private var session: ProviderSession?
    private var user: UInt32?
    private var heartbeat: Int64 = 0
    private var queue = [[String: Any]]()
    private var processes = [Int32: ProcessMetadata]()
    private var flows = [UUID: MonitorEndpoint]()
    private var lost = false
    private var generation = UUID()
    private var timer: DispatchSourceTimer?

    override func startFilter(completionHandler: @escaping (Error?) -> Void) {
        guard let service = monitorMachService(Bundle.main) else {
            completionHandler(NSError(domain: "OhMyToken.Network", code: 1)); return
        }
        let listener = NSXPCListener(machServiceName: service)
        listener.delegate = self; listener.resume(); self.listener = listener
        let timer = DispatchSource.makeTimerSource(queue: stateQueue)
        timer.schedule(deadline: .now() + 2, repeating: 2)
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            if self.user != nil && monitorNow() - self.heartbeat > 6000 { self.clear() }
        }
        timer.resume(); self.timer = timer
        // Allow every flow. Ask only for byte-count reports, never packet contents.
        apply(NEFilterSettings(rules: [], defaultAction: .filterData), completionHandler: completionHandler)
    }
    override func stopFilter(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        stateQueue.sync { clear(); timer?.cancel(); timer = nil }
        listener?.invalidate(); listener = nil; completionHandler()
    }
    private func clear() {
        generation = UUID()
        user = nil; flows.removeAll(); processes.removeAll(); queue.removeAll(); lost = false
    }
    private func enqueue(_ message: [String: Any]) {
        if queue.count < 4096 { queue.append(message) } else { lost = true }
    }
    private func register(_ process: ProcessMetadata) {
        if processes.count >= 20000 && processes[process.pid] == nil { lost = true; return }
        var row = process
        if let parent = processes[process.parent], parent.born <= process.born { row.value["parentKey"] = parent.key }
        if processes[process.pid]?.key == row.key { return }
        processes[process.pid] = row
        enqueue(["type": "processes", "processes": [row.value]])
    }
    override func handleNewFlow(_ flow: NEFilterFlow) -> NEFilterNewFlowVerdict {
        let verdict = NEFilterNewFlowVerdict.allow()
        stateQueue.sync {
            guard let uid = user, let socket = flow as? NEFilterSocketFlow else { return }
            guard let process = ProcessMetadata.read(audit: flow.sourceProcessAuditToken), process.uid == uid else {
                if ProcessMetadata.belongsToUser(flow.sourceProcessAuditToken, uid: uid) ||
                   ProcessMetadata.belongsToUser(flow.sourceAppAuditToken, uid: uid) {
                    enqueue(["type": "issue", "issue": "identity-unavailable"])
                }
                return
            }
            guard let endpoint = MonitorEndpoint(flow: socket, process: process.key) else { return }
            if flows.count >= 10000 { lost = true; return }
            // Observe ancestry while the processes exist. Never substitute a
            // newly reused PID for an older parent or audit-token generation.
            var chain = [process], current = process, seen = Set<Int32>([process.pid])
            for _ in 0..<64 {
                guard current.parent > 0, !seen.contains(current.parent),
                      let parent = ProcessMetadata.read(current.parent), parent.uid == uid, parent.born <= current.born else { break }
                chain.append(parent); seen.insert(parent.pid); current = parent
            }
            for parent in chain.reversed() { register(parent) }
            let responsible = ProcessMetadata.read(audit: flow.sourceAppAuditToken)
            if let responsible = responsible, responsible.uid == uid, responsible.key != process.key {
                register(responsible); endpoint.responsibleKey = responsible.key
            }
            flows[flow.identifier] = endpoint
            verdict.statisticsReportFrequency = .high
            verdict.shouldReport = true
        }
        return verdict
    }
    override func handle(_ report: NEFilterReport) {
        guard report.event == .statistics || report.event == .flowClosed, let flow = report.flow else { return }
        stateQueue.sync {
            guard user != nil, let endpoint = flows[flow.identifier] else { return }
            enqueue(["type": "traffic", "samples": [["processKey": endpoint.process, "flowId": flow.identifier.uuidString,
                "responsibleKey": endpoint.responsibleKey as Any? ?? NSNull(), "protocol": endpoint.transport, "localAddress": endpoint.local, "localPort": endpoint.localPort,
                "remoteAddress": endpoint.remote, "remotePort": endpoint.remotePort, "sent": max(0, report.bytesOutboundCount),
                "received": max(0, report.bytesInboundCount), "counter": "cumulative", "closed": report.event == .flowClosed, "at": monitorNow()]]])
            if report.event == .flowClosed { flows.removeValue(forKey: flow.identifier) }
        }
    }
    private func trusted(_ connection: NSXPCConnection) -> Bool {
        guard let team = Bundle.main.object(forInfoDictionaryKey: "OMTTeamIdentifier") as? String,
              team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { return false }
        var code: SecCode?, requirement: SecRequirement?
        let attributes = [kSecGuestAttributePid as String: connection.processIdentifier] as CFDictionary
        let condition = "anchor apple generic and certificate leaf[subject.OU] = \"\(team)\" and (identifier \"net.ohmytoken.desktop\" or identifier \"net.ohmytoken.desktop.network-monitor\")"
        guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess, let code = code,
              SecRequirementCreateWithString(condition as CFString, [], &requirement) == errSecSuccess else { return false }
        return SecCodeCheckValidity(code, [], requirement) == errSecSuccess
    }
    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection incoming: NSXPCConnection) -> Bool {
        guard trusted(incoming) else { return false }
        return stateQueue.sync {
            if connection != nil { return false }
            let session = ProviderSession(provider: self, uid: incoming.effectiveUserIdentifier)
            incoming.exportedInterface = NSXPCInterface(with: MonitorProviderControl.self)
            incoming.exportedObject = session
            let disconnect: () -> Void = { [weak self, weak incoming] in
                self?.stateQueue.async { [weak self, weak incoming] in
                    guard let self = self, self.connection === incoming else { return }
                    self.clear(); self.connection = nil; self.session = nil
                }
            }
            incoming.invalidationHandler = disconnect; incoming.interruptionHandler = disconnect
            connection = incoming; self.session = session; incoming.resume(); return true
        }
    }
    fileprivate func begin(uid: UInt32, reply: @escaping (Bool) -> Void) {
        stateQueue.async {
            self.clear()
            let generation = self.generation
            // Process enumeration can be slow. Keep new network flows free to
            // pass while preparing metadata, then begin the measured session.
            DispatchQueue.global(qos: .utility).async {
                let initial = ProcessMetadata.snapshot(uid: uid).sorted { $0.born < $1.born }
                self.stateQueue.async {
                    guard self.generation == generation, self.connection != nil else { reply(false); return }
                    for row in initial { self.register(row) }
                    self.user = uid; self.heartbeat = monitorNow()
                    self.enqueue(["type": "issue", "issue": "new-flows-only"])
                    reply(true)
                }
            }
        }
    }
    private func drain() -> Data {
        if lost { queue.append(["type": "issue", "issue": "events-lost"]); lost = false }
        var bytes = Data()
        for message in queue { if let line = monitorJSON(message) { bytes.append(line); bytes.append(10) } }
        queue.removeAll(keepingCapacity: true)
        return bytes
    }
    fileprivate func poll(reply: @escaping (Data) -> Void) {
        stateQueue.async {
            self.heartbeat = monitorNow()
            for (pid, row) in self.processes {
                if !omt_process_matches(pid, row.born) {
                    self.enqueue(["type": "exit", "key": row.key, "at": monitorNow()]); self.processes.removeValue(forKey: pid)
                }
            }
            reply(self.drain())
        }
    }
    fileprivate func end(reply: @escaping (Data) -> Void) {
        stateQueue.async { let final = self.drain(); self.clear(); reply(final) }
    }
}

private final class ProviderSession: NSObject, MonitorProviderControl {
    weak var provider: FilterDataProvider?
    let uid: UInt32
    init(provider: FilterDataProvider, uid: UInt32) { self.provider = provider; self.uid = uid }
    func begin(_ reply: @escaping (Bool) -> Void) { provider?.begin(uid: uid, reply: reply) }
    func poll(_ reply: @escaping (Data) -> Void) { provider?.poll(reply: reply) }
    func end(_ reply: @escaping (Data) -> Void) { provider?.end(reply: reply) }
}
