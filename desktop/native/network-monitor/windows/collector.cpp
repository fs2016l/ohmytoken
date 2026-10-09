#include "monitor.h"
#include "identity-gaps.h"
#include "file-observer.h"
#include <tdh.h>
#include <ws2tcpip.h>
#include <shellapi.h>
#include <atomic>
#include <thread>
#include <mutex>
#include <unordered_map>
#include <iostream>
#include <cstring>
#include <sstream>

namespace omt {
static const GUID tcpGuid{0x9a280ac0,0xc8e0,0x11d1,{0x84,0xe2,0x00,0xc0,0x4f,0xb9,0x98,0xa2}};
static const GUID udpGuid{0xbf3a50c5,0xa9c9,0x4988,{0xa0,0x05,0x2d,0xf0,0xb7,0xc8,0x0f,0x80}};
static const GUID processGuid{0x3d6fa8d0,0xfe05,0x11d0,{0x9d,0xda,0x00,0xc0,0x4f,0xd7,0xba,0x7c}};
static const GUID fileGuid{0x90cbdc39,0x4a3e,0x11d1,{0x84,0xf4,0x00,0x00,0xf8,0x04,0x64,0xe3}};
static GUID sessionGuid(const std::wstring& sid) {
  GUID value{0x2729d702,0x9e26,0x4be3,{0xa8,0x3b,0xb6,0x0c,0x8a,0x75,0x40,0x32}};
  uint64_t hash = 14695981039346656037ULL;
  for (wchar_t c : sid) { hash ^= c; hash *= 1099511628211ULL; }
  memcpy(&value, &hash, sizeof(hash));
  return value;
}
static void enableProfilePrivilege() {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &token)) return;
  TOKEN_PRIVILEGES privileges{}; privileges.PrivilegeCount = 1;
  if (LookupPrivilegeValueW(nullptr, SE_SYSTEM_PROFILE_NAME, &privileges.Privileges[0].Luid)) {
    privileges.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
    AdjustTokenPrivileges(token, FALSE, &privileges, 0, nullptr, nullptr);
  }
  CloseHandle(token);
}
struct TraceProperties {
  EVENT_TRACE_PROPERTIES value{};
  wchar_t name[512]{};
  explicit TraceProperties(const std::wstring& session) {
    value.Wnode.BufferSize = sizeof(*this);
    value.Wnode.ClientContext = 2; value.Wnode.Flags = WNODE_FLAG_TRACED_GUID;
    value.BufferSize = 64; value.MinimumBuffers = 16; value.MaximumBuffers = 128;
    value.LogFileMode = EVENT_TRACE_REAL_TIME_MODE | EVENT_TRACE_SYSTEM_LOGGER_MODE;
    value.FlushTimer = 1;
    value.EnableFlags = EVENT_TRACE_FLAG_NETWORK_TCPIP | EVENT_TRACE_FLAG_PROCESS;
    value.LoggerNameOffset = offsetof(TraceProperties, name);
    wcsncpy_s(name, session.c_str(), _TRUNCATE);
  }
};
static bool property(EVENT_RECORD* event, const wchar_t* name, void* data, ULONG size) {
  PROPERTY_DATA_DESCRIPTOR descriptor{};
  descriptor.PropertyName = reinterpret_cast<ULONGLONG>(name); descriptor.ArrayIndex = ULONG_MAX;
  return TdhGetProperty(event, 0, nullptr, 1, &descriptor, size, static_cast<PBYTE>(data)) == ERROR_SUCCESS;
}
struct Packet {
  DWORD pid = 0, size = 0;
  unsigned char source[16]{}, destination[16]{};
  uint16_t sourcePort = 0, destinationPort = 0;
};
static bool decode(EVENT_RECORD* event, bool ipv6, Packet& packet) {
  const ULONG addressSize = ipv6 ? 16 : 4;
  // Both documented v2 TCP and UDP schemas start with PID, size, daddr,
  // saddr, dport, sport. Do not use EventHeader.ProcessId for kernel sends.
  if (event->EventHeader.EventDescriptor.Version == 2 && event->UserDataLength >= 12 + addressSize * 2) {
    const auto data = static_cast<const unsigned char*>(event->UserData);
    memcpy(&packet.pid, data, 4); memcpy(&packet.size, data + 4, 4);
    memcpy(packet.destination, data + 8, addressSize); memcpy(packet.source, data + 8 + addressSize, addressSize);
    memcpy(&packet.destinationPort, data + 8 + addressSize * 2, 2); memcpy(&packet.sourcePort, data + 10 + addressSize * 2, 2);
    return true;
  }
  return property(event, L"PID", &packet.pid, 4) && property(event, L"size", &packet.size, 4) &&
    property(event, L"daddr", packet.destination, addressSize) && property(event, L"saddr", packet.source, addressSize) &&
    property(event, L"dport", &packet.destinationPort, 2) && property(event, L"sport", &packet.sourcePort, 2);
}
struct Flow {
  std::string key, id, protocol, local, remote;
  uint16_t localPort = 0, remotePort = 0;
  uint64_t sent = 0, received = 0, at = 0;
  std::string json() const {
    return "{\"processKey\":" + quote(key) + ",\"flowId\":" + quote(id) + ",\"protocol\":" + quote(protocol) +
      ",\"localAddress\":" + quote(local) + ",\"remoteAddress\":" + quote(remote) + ",\"localPort\":" + std::to_string(localPort) +
      ",\"remotePort\":" + std::to_string(remotePort) + ",\"sent\":" + std::to_string(sent) + ",\"received\":" + std::to_string(received) +
      ",\"at\":" + std::to_string(at) + ",\"counter\":\"delta\"}";
  }
};
class Collector {
 public:
  std::wstring sid;
  Pipe pipe;
  HANDLE stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  TRACEHANDLE consumer = INVALID_PROCESSTRACE_HANDLE;
  std::atomic<bool> lost{false}, identityLost{false};
  std::mutex mutex;
  std::unordered_map<DWORD, Process> processes;
  IdentityGaps identityGaps;
  std::unordered_map<std::string, Flow> flows;
  std::vector<std::string> pending;
  FileObserver files;
  std::unordered_map<std::string, bool> fileTargets;
  bool watched(DWORD pid, uint64_t at) {
    auto row = processes.find(pid);
    if (row == processes.end() || row->second.started > at) return false;
    for (int depth = 0; row != processes.end() && depth < 128; ++depth) {
      const auto match = fileTargets.find(row->second.key());
      if (match != fileTargets.end() && (depth == 0 || match->second)) return true;
      const auto parent = processes.find(row->second.parent);
      if (parent == processes.end() || parent->second.started > row->second.started || parent->first == row->first) return false;
      if (!row->second.verifiedParentKey.empty() && parent->second.key() != row->second.verifiedParentKey) return false;
      row = parent;
    }
    return false;
  }
  bool configureFiles(const std::string& command, TRACEHANDLE session, const std::wstring& name) {
    std::istringstream input(command); std::string tag, mode, key; uint64_t epoch = 0;
    if (!(input >> tag >> epoch >> mode) || tag != "files" || (mode != "on" && mode != "off")) return false;
    std::unordered_map<std::string, bool> targets;
    while (input >> key) {
      if (targets.size() >= 20000 || key.size() > 129 || key.size() < 4 || (key.back() != '+' && key.back() != '-')) return false;
      const bool descendants = key.back() == '+'; key.pop_back();
      if (key.find_first_not_of("0123456789:abcdefABCDEF.-") != std::string::npos || key.find(':') == std::string::npos) return false;
      targets[key] = descendants;
    }
    std::lock_guard<std::mutex> lock(mutex);
    const bool enable = mode == "on";
    if (files.epoch != epoch || files.enabled != enable) files.clear();
    files.epoch = epoch; fileTargets = std::move(targets);
    TraceProperties update(name);
    if (enable) update.value.EnableFlags |= EVENT_TRACE_FLAG_FILE_IO | EVENT_TRACE_FLAG_FILE_IO_INIT;
    const auto result = files.enabled == enable ? ERROR_SUCCESS : ControlTraceW(session, nullptr, &update.value, EVENT_TRACE_CONTROL_UPDATE);
    files.enabled = enable && result == ERROR_SUCCESS;
    if (pending.size() < 20000) pending.push_back(files.status(enable && !files.enabled ? "unavailable" : enable ? "running" : "off"));
    return true;
  }
  ~Collector() { CloseHandle(stop); }

  void publish(const Process& row) {
    const auto old = processes.find(row.pid);
    if (old != processes.end() && old->second.birth > row.birth) return;
    if (old != processes.end() && old->second.birth == row.birth &&
        (!old->second.verifiedParentKey.empty() || (row.verifiedParentKey.empty() && (old->second.parent || !row.parent)))) return;
    processes[row.pid] = row;
    if (pending.size() < 20000) pending.push_back("{\"type\":\"processes\",\"processes\":[" + row.json() + "]}");
    else lost = true;
  }
  void processEvent(EVENT_RECORD* event) {
    DWORD pid = 0, parent = 0;
    if (!property(event, L"ProcessId", &pid, 4)) return;
    const auto op = event->EventHeader.EventDescriptor.Opcode;
    const auto at = unixMillis(event->EventHeader.TimeStamp.QuadPart);
    if (op == EVENT_TRACE_TYPE_START || op == EVENT_TRACE_TYPE_DC_START) {
      property(event, L"ParentId", &parent, 4);
      Process row;
      identityGaps.end(pid, at);
      if (readProcess(pid, parent, sid, row) && row.started <= at) publish(row);
      else {
        const auto stale = processes.find(pid);
        if (stale != processes.end() && stale->second.started <= at) {
          if (pending.size() < 20000) pending.push_back("{\"type\":\"exit\",\"key\":" + quote(stale->second.key()) + ",\"at\":" + std::to_string(at) + "}");
          else lost = true;
          processes.erase(stale);
        }
        const auto knownParent = processes.find(parent);
        const auto parentKey = knownParent != processes.end() && knownParent->second.started <= at
          ? knownParent->second.key() : identityGaps.parent(parent, at);
        if (!identityGaps.remember(pid, parentKey, at)) lost = true;
      }
    } else if (op == EVENT_TRACE_TYPE_END) {
      identityGaps.end(pid, at);
      auto known = processes.find(pid);
      if (known != processes.end() && known->second.started <= at) {
        if (pending.size() < 20000) pending.push_back("{\"type\":\"exit\",\"key\":" + quote(known->second.key()) + ",\"at\":" + std::to_string(at) + "}");
        else lost = true;
        processes.erase(known);
      }
    }
  }
  bool unresolvedTraffic(const Packet& packet, bool outbound, bool ipv6, uint64_t at) {
    if (!packet.size) return false;
    const auto parentKey = identityGaps.parent(packet.pid, at);
    if (parentKey.empty()) return false;
    char remote[INET6_ADDRSTRLEN]{};
    if (!InetNtopA(ipv6 ? AF_INET6 : AF_INET, outbound ? packet.destination : packet.source, remote, sizeof(remote))) {
      lost = true; return true;
    }
    if (pending.size() >= 20000) { lost = true; return true; }
    pending.push_back("{\"type\":\"unattributed\",\"gap\":{\"parentKey\":" + quote(parentKey) +
      ",\"remoteAddress\":" + quote(std::string(remote)) + ",\"at\":" + std::to_string(at) +
      ",\"sent\":" + std::to_string(outbound ? packet.size : 0) + ",\"received\":" + std::to_string(outbound ? 0 : packet.size) + "}}");
    return true;
  }
  void event(EVENT_RECORD* event) {
    std::lock_guard<std::mutex> lock(mutex);
    if (event->EventHeader.ProviderId == processGuid) { processEvent(event); return; }
    if (event->EventHeader.ProviderId == fileGuid) {
      files.event(event, [&](DWORD pid, uint64_t at) { return watched(pid, at) ? processes.at(pid).key() : std::string(); });
      return;
    }
    const bool tcp = event->EventHeader.ProviderId == tcpGuid;
    if (!tcp && event->EventHeader.ProviderId != udpGuid) return;
    const auto op = event->EventHeader.EventDescriptor.Opcode;
    if (op != 10 && op != 11 && op != 26 && op != 27) return;
    const bool ipv6 = op >= 26, outbound = op == 10 || op == 26;
    Packet packet;
    if (!decode(event, ipv6, packet)) { lost = true; return; }
    const auto at = unixMillis(event->EventHeader.TimeStamp.QuadPart);
    auto known = processes.find(packet.pid);
    if (known == processes.end()) {
      Process row;
      if (!readProcess(packet.pid, 0, sid, row)) {
        unresolvedTraffic(packet, outbound, ipv6, at);
        return; // Other users and unrelated protected processes are outside this user's scope.
      }
      if (row.started <= at) {
        row.verifiedParentKey = identityGaps.parent(packet.pid, at);
        if (!row.verifiedParentKey.empty()) row.parent = static_cast<DWORD>(std::stoul(row.verifiedParentKey));
      }
      publish(row); known = processes.find(packet.pid);
    }
    if (known->second.started > at) {
      if (!unresolvedTraffic(packet, outbound, ipv6, at)) identityLost = true;
      return;
    }
    char source[INET6_ADDRSTRLEN]{}, destination[INET6_ADDRSTRLEN]{};
    if (!InetNtopA(ipv6 ? AF_INET6 : AF_INET, packet.source, source, sizeof(source)) ||
        !InetNtopA(ipv6 ? AF_INET6 : AF_INET, packet.destination, destination, sizeof(destination))) { lost = true; return; }
    Flow flow;
    flow.key = known->second.key(); flow.protocol = tcp ? "tcp" : "udp";
    flow.local = outbound ? source : destination; flow.remote = outbound ? destination : source;
    flow.localPort = ntohs(outbound ? packet.sourcePort : packet.destinationPort);
    flow.remotePort = ntohs(outbound ? packet.destinationPort : packet.sourcePort);
    flow.id = flow.protocol + ":" + flow.local + ":" + std::to_string(flow.localPort) + "-" + flow.remote + ":" + std::to_string(flow.remotePort);
    const auto id = flow.key + ":" + flow.id;
    auto existing = flows.find(id);
    if (existing == flows.end()) {
      if (flows.size() >= 10000) { lost = true; return; }
      existing = flows.emplace(id, std::move(flow)).first;
    }
    if (outbound) existing->second.sent += packet.size; else existing->second.received += packet.size;
    existing->second.at = at;
  }
  bool flush() {
    std::vector<std::string> metadata;
    std::unordered_map<std::string, Flow> traffic;
    { std::lock_guard<std::mutex> lock(mutex); metadata.swap(pending); traffic.swap(flows); identityGaps.prune(now());
      const auto evidence = files.drain(); metadata.insert(metadata.end(), evidence.begin(), evidence.end()); }
    for (const auto& line : metadata) if (!pipe.write(line)) return false;
    std::string batch; size_t count = 0;
    for (const auto& [key, flow] : traffic) {
      if (count++) batch += ',';
      batch += flow.json();
      if (count == 512) { if (!pipe.write("{\"type\":\"traffic\",\"samples\":[" + batch + "]}")) return false; batch.clear(); count = 0; }
    }
    if (count && !pipe.write("{\"type\":\"traffic\",\"samples\":[" + batch + "]}")) return false;
    if (lost.exchange(false) && !pipe.write("{\"type\":\"issue\",\"issue\":\"events-lost\"}")) return false;
    if (identityLost.exchange(false) && !pipe.write("{\"type\":\"issue\",\"issue\":\"identity-unavailable\"}")) return false;
    return true;
  }
};
static void WINAPI receive(EVENT_RECORD* event) { static_cast<Collector*>(event->UserContext)->event(event); }
static int elevateHelper(const std::wstring& sessionId, DWORD parentPid) {
  wchar_t exe[32768]; if (!GetModuleFileNameW(nullptr, exe, DWORD(std::size(exe)))) return 1;
  const std::wstring args = L"--session " + sessionId + L" --parent " + std::to_wstring(parentPid) + L" --no-elevation";
  SHELLEXECUTEINFOW info{}; info.cbSize = sizeof(info); info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
  info.lpVerb = L"runas"; info.lpFile = exe; info.lpParameters = args.c_str(); info.nShow = SW_HIDE;
  if (!ShellExecuteExW(&info)) return GetLastError() == ERROR_CANCELLED ? 42 : 1;
  if (info.hProcess) CloseHandle(info.hProcess);
  return 0;
}
int collect(const std::wstring& sessionId, DWORD parentPid, bool elevate) {
  HANDLE parent = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, parentPid);
  if (!parent) return 1;
  const auto sid = userSid(parent); CloseHandle(parent);
  if (sid.empty()) return 1;
  const auto name = L"OhMyToken-Network-" + sid;
  const auto mutexName = L"Global\\OhMyToken-Network-" + sid;
  HANDLE ownership = CreateMutexW(nullptr, FALSE, mutexName.c_str());
  if (!ownership) return 1;
  const auto acquired = WaitForSingleObject(ownership, 0);
  if (acquired != WAIT_OBJECT_0 && acquired != WAIT_ABANDONED) { CloseHandle(ownership); return 1; }
  struct Owner {
    HANDLE handle;
    void release() { if (handle) { ReleaseMutex(handle); CloseHandle(handle); handle = nullptr; } }
    ~Owner() { release(); }
  } owner{ownership};
  enableProfilePrivilege();
  TraceProperties properties(name); TRACEHANDLE session = 0;
  properties.value.Wnode.Guid = sessionGuid(sid);
  const auto startedAt = now();
  auto status = StartTraceW(&session, name.c_str(), &properties.value);
  if (status == ERROR_ALREADY_EXISTS) {
    TraceProperties existing(name);
    if (ControlTraceW(0, name.c_str(), &existing.value, EVENT_TRACE_CONTROL_QUERY) == ERROR_SUCCESS && existing.value.Wnode.Guid == sessionGuid(sid)) {
      // Holding the per-user mutex proves no live helper owns this session.
      ControlTraceW(0, name.c_str(), &existing.value, EVENT_TRACE_CONTROL_STOP);
      status = StartTraceW(&session, name.c_str(), &properties.value);
    }
  }
  if (status == ERROR_ACCESS_DENIED || status == ERROR_PRIVILEGE_NOT_HELD) {
    owner.release(); // Also permit UAC with a different administrator account.
    return elevate ? elevateHelper(sessionId, parentPid) : 41;
  }
  if (status != ERROR_SUCCESS) { std::cerr << "StartTrace failed: " << status << '\n'; return 1; }
  Collector collector; collector.sid = sid;
  if (!collector.pipe.connect(L"\\\\.\\pipe\\ohmytoken-network-" + sessionId, parentPid, sid)) {
    ControlTraceW(session, nullptr, &properties.value, EVENT_TRACE_CONTROL_STOP); return 1;
  }
  EVENT_TRACE_LOGFILEW log{}; log.LoggerName = const_cast<wchar_t*>(name.c_str());
  log.ProcessTraceMode = PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD;
  log.EventRecordCallback = receive; log.Context = &collector;
  collector.consumer = OpenTraceW(&log);
  if (collector.consumer == INVALID_PROCESSTRACE_HANDLE) {
    ControlTraceW(session, nullptr, &properties.value, EVENT_TRACE_CONTROL_STOP); return 1;
  }
  for (const auto& row : snapshot(sid)) collector.publish(row);
  collector.flush();
  if (!collector.pipe.write("{\"type\":\"ready\",\"version\":1,\"startedAt\":" + std::to_string(startedAt) + "}")) SetEvent(collector.stop);
  std::thread reader([&] {
    std::string input, buffer;
    while (WaitForSingleObject(collector.stop, 0) == WAIT_TIMEOUT && collector.pipe.read(input, collector.stop)) {
      buffer += input;
      if (buffer.size() > 1024 * 1024) break;
      size_t end;
      bool invalid = false;
      while ((end = buffer.find('\n')) != std::string::npos) {
        const auto line = buffer.substr(0, end); buffer.erase(0, end + 1);
        if (line == "stop") { invalid = true; break; }
        if (line != "ping" && !collector.configureFiles(line, session, name)) { invalid = true; break; }
      }
      if (invalid) break;
    }
    SetEvent(collector.stop);
  });
  HANDLE traceFinished = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  std::thread trace([&] {
    const auto result = ProcessTrace(&collector.consumer, 1, nullptr, nullptr);
    if (result != ERROR_SUCCESS && result != ERROR_CANCELLED) collector.lost = true;
    SetEvent(traceFinished); SetEvent(collector.stop);
  });
  ULONG lost = 0;
  while (WaitForSingleObject(collector.stop, 1000) == WAIT_TIMEOUT && collector.pipe.parentAlive()) {
    if (!collector.flush()) break;
    TraceProperties query(name);
    if (ControlTraceW(session, nullptr, &query.value, EVENT_TRACE_CONTROL_QUERY) == ERROR_SUCCESS) {
      const auto total = query.value.EventsLost + query.value.RealTimeBuffersLost;
      if (total > lost) collector.lost = true;
      lost = total;
    }
  }
  SetEvent(collector.stop);
  ControlTraceW(session, nullptr, &properties.value, EVENT_TRACE_CONTROL_STOP);
  // STOP flushes the final ETW buffers. Let ProcessTrace drain them before
  // closing its handle; closing immediately can discard the last interval.
  if (WaitForSingleObject(traceFinished, 1500) != WAIT_OBJECT_0) collector.lost = true;
  CloseTrace(collector.consumer); trace.join(); CloseHandle(traceFinished);
  if (properties.value.EventsLost + properties.value.RealTimeBuffersLost > lost) collector.lost = true;
  collector.flush(); collector.pipe.write("{\"type\":\"stopped\"}");
  collector.pipe.cancel(); reader.join(); return 0;
}
}
