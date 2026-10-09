import Foundation

struct ProcessMetadata {
    let key: String
    let pid: Int32
    let uid: UInt32
    let parent: Int32
    let born: UInt64
    var value: [String: Any]

    init(_ source: OMTProcessInfo) {
        var info = source
        pid = info.pid; uid = info.uid; parent = info.parent; born = info.birthMicros
        key = "\(info.pid):\(info.birthMicros)-\(info.version)"
        let path = withUnsafePointer(to: &info.path) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: 4096) { String(cString: $0) }
        }
        let entry = withUnsafePointer(to: &info.entry) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: 4096) { String(cString: $0) }
        }
        value = ["key": key, "pid": Int(pid), "parentPid": Int(parent), "parentKey": NSNull(),
                 "startedAt": info.birthMicros / 1000, "path": path, "name": URL(fileURLWithPath: path).lastPathComponent]
        if !entry.isEmpty { value["entryPoint"] = entry }
        if let range = path.range(of: ".app/") {
            let appPath = String(path[..<range.lowerBound]) + ".app"
            value["bundlePath"] = appPath
            value["bundleId"] = Bundle(path: appPath)?.bundleIdentifier
        }
    }
    static func read(_ pid: Int32) -> ProcessMetadata? {
        var info = OMTProcessInfo()
        return omt_process_info(pid, &info) ? ProcessMetadata(info) : nil
    }
    static func read(audit: Data?) -> ProcessMetadata? {
        guard let audit = audit else { return nil }
        var info = OMTProcessInfo()
        return audit.withUnsafeBytes { omt_audit_process($0.baseAddress, $0.count, &info) } ? ProcessMetadata(info) : nil
    }
    static func snapshot(uid: UInt32) -> [ProcessMetadata] {
        var ids = [Int32](repeating: 0, count: 20000)
        let count = ids.withUnsafeMutableBufferPointer { omt_process_list($0.baseAddress, Int32($0.count)) }
        return ids.prefix(Int(count)).compactMap { ProcessMetadata.read($0) }.filter { $0.uid == uid }
    }
    static func belongsToUser(_ audit: Data?, uid: UInt32) -> Bool {
        guard let audit = audit else { return false }
        return audit.withUnsafeBytes { omt_audit_has_uid($0.baseAddress, $0.count, uid) }
    }
}

func monitorJSON(_ value: [String: Any]) -> Data? { try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) }
func monitorNow() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
