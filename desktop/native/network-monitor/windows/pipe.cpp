#include "monitor.h"
#include <sddl.h>

namespace omt {
Pipe::~Pipe() {
  if (handle != INVALID_HANDLE_VALUE) { CancelIoEx(handle, nullptr); DisconnectNamedPipe(handle); CloseHandle(handle); }
  if (parent) CloseHandle(parent);
}
bool Pipe::parentAlive() const { return parent && WaitForSingleObject(parent, 0) == WAIT_TIMEOUT; }
bool Pipe::connect(const std::wstring& name, DWORD parentPid, const std::wstring& sid) {
  parent = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, parentPid);
  if (!parent || sid.empty() || userSid(parent) != sid) return false;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  const std::wstring sddl = L"D:P(A;;GA;;;SY)(A;;GA;;;" + sid + L")";
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr)) return false;
  SECURITY_ATTRIBUTES security{ sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE };
  handle = CreateNamedPipeW(name.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED,
    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 65536, 65536, 0, &security);
  LocalFree(descriptor);
  if (handle == INVALID_HANDLE_VALUE) return false;
  OVERLAPPED io{}; io.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  bool ok = ConnectNamedPipe(handle, &io) != FALSE;
  const auto error = GetLastError();
  if (!ok && error == ERROR_PIPE_CONNECTED) ok = true;
  if (!ok && error == ERROR_IO_PENDING) {
    HANDLE wait[]{ io.hEvent, parent };
    ok = WaitForMultipleObjects(2, wait, FALSE, 30000) == WAIT_OBJECT_0;
    if (!ok) CancelIoEx(handle, &io);
    DWORD transferred = 0;
    ok = GetOverlappedResult(handle, &io, &transferred, TRUE) && ok;
  }
  CloseHandle(io.hEvent);
  ULONG client = 0;
  return ok && GetNamedPipeClientProcessId(handle, &client) && client == parentPid && parentAlive();
}
bool Pipe::write(const std::string& message) {
  if (!parentAlive()) return false;
  const auto line = message + '\n';
  OVERLAPPED io{}; io.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  DWORD done = 0;
  bool ok = WriteFile(handle, line.data(), DWORD(line.size()), &done, &io) != FALSE;
  if (!ok && GetLastError() == ERROR_IO_PENDING) {
    HANDLE wait[]{ io.hEvent, parent };
    ok = WaitForMultipleObjects(2, wait, FALSE, 3000) == WAIT_OBJECT_0;
    if (!ok) CancelIoEx(handle, &io);
    ok = GetOverlappedResult(handle, &io, &done, TRUE) && ok;
  }
  CloseHandle(io.hEvent);
  return ok && done == line.size();
}
bool Pipe::read(std::string& text, HANDLE stop) {
  char buffer[256]; DWORD done = 0;
  OVERLAPPED io{}; io.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  bool ok = ReadFile(handle, buffer, sizeof(buffer), &done, &io) != FALSE;
  if (!ok && GetLastError() == ERROR_IO_PENDING) {
    HANDLE wait[]{ io.hEvent, parent, stop };
    ok = WaitForMultipleObjects(3, wait, FALSE, 10000) == WAIT_OBJECT_0;
    if (!ok) CancelIoEx(handle, &io);
    ok = GetOverlappedResult(handle, &io, &done, TRUE) && ok;
  }
  CloseHandle(io.hEvent);
  if (ok) text.assign(buffer, done);
  return ok && done > 0;
}
void Pipe::cancel() { if (handle != INVALID_HANDLE_VALUE) CancelIoEx(handle, nullptr); }
}
