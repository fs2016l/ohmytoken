#include <node_api.h>
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <cmath>
#include <cstring>

namespace {
constexpr UINT_PTR frameId = 0x4f4d5446;
const UINT resizeMessage = RegisterWindowMessageW(L"OhMyToken.FloatingResize");
LRESULT CALLBACK frameProc(HWND, UINT, WPARAM, LPARAM, UINT_PTR, DWORD_PTR);
bool isResize(LRESULT hit) { return hit >= HTLEFT && hit <= HTBOTTOMRIGHT; }

// The renderer owns one visible resize contour and its cursor. Suppress Chromium's
// separate resize band at the outer transparent window, including its input child.
LRESULT CALLBACK inputProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam,
                           UINT_PTR id, DWORD_PTR) {
  if (message == WM_NCDESTROY) RemoveWindowSubclass(hwnd, inputProc, id);
  const LRESULT result = DefSubclassProc(hwnd, message, wParam, lParam);
  return message == WM_NCHITTEST && isResize(result) ? HTCLIENT : result;
}

BOOL CALLBACK attachInput(HWND child, LPARAM) {
  wchar_t name[80]{};
  GetClassNameW(child, name, 80);
  if (wcscmp(name, L"Chrome_RenderWidgetHostHWND") == 0 &&
      GetWindowThreadProcessId(child, nullptr) == GetCurrentThreadId())
    SetWindowSubclass(child, inputProc, frameId, 0);
  return TRUE;
}

LRESULT CALLBACK frameProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam,
                           UINT_PTR id, DWORD_PTR enabled) {
  if (resizeMessage && message == resizeMessage) {
    if (enabled && isResize(wParam) && (GetAsyncKeyState(VK_LBUTTON) & 0x8000)) {
      // Preserve the actual down point inside the shadow gutter, using the mouse
      // resize entry instead of starting a menu/keyboard SC_SIZE operation.
      ReleaseCapture();
      return DefWindowProcW(hwnd, WM_NCLBUTTONDOWN, wParam, lParam);
    }
    return 0;
  }
  if (message == WM_NCDESTROY) RemoveWindowSubclass(hwnd, frameProc, id);
  const LRESULT result = DefSubclassProc(hwnd, message, wParam, lParam);
  return message == WM_NCHITTEST && isResize(result) ? HTCLIENT : result;
}

napi_value fail(napi_env env, const char* message) {
  napi_throw_error(env, "FLOATING_FRAME", message);
  return nullptr;
}

HWND readWindow(napi_env env, napi_value value) {
  bool buffer = false;
  napi_is_buffer(env, value, &buffer);
  if (!buffer) { fail(env, "Window handle must be a Buffer"); return nullptr; }
  void* bytes = nullptr;
  size_t length = 0;
  napi_get_buffer_info(env, value, &bytes, &length);
  if (length != sizeof(HWND)) { fail(env, "Invalid window handle size"); return nullptr; }
  HWND hwnd = nullptr;
  std::memcpy(&hwnd, bytes, sizeof(hwnd));
  DWORD owner = 0;
  const DWORD thread = GetWindowThreadProcessId(hwnd, &owner);
  if (!IsWindow(hwnd) || owner != GetCurrentProcessId() || thread != GetCurrentThreadId()) {
    fail(env, "Only application windows on this thread may be changed"); return nullptr;
  }
  return hwnd;
}
}

napi_value configureFloatingFrame(napi_env env, napi_callback_info info) {
  size_t count = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (count != 3) return fail(env, "Expected window handle, panel inset and resize state");
  const HWND hwnd = readWindow(env, args[0]);
  if (!hwnd) return nullptr;
  double inset = 0;
  if (napi_get_value_double(env, args[1], &inset) != napi_ok ||
      !std::isfinite(inset) || inset < 0 || inset > 64 || std::floor(inset) != inset)
    return fail(env, "Invalid panel inset");
  bool enabled = false;
  if (napi_get_value_bool(env, args[2], &enabled) != napi_ok)
    return fail(env, "Resize state must be a boolean");
  if (!SetWindowSubclass(hwnd, frameProc, frameId, enabled ? 1 : 0))
    return fail(env, "Could not attach the floating window frame");
  EnumChildWindows(hwnd, attachInput, 0);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value beginFloatingResize(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (count != 2) return fail(env, "Expected window handle and resize direction");
  const HWND hwnd = readWindow(env, args[0]);
  if (!hwnd) return nullptr;
  double direction = 0;
  if (napi_get_value_double(env, args[1], &direction) != napi_ok ||
      !std::isfinite(direction) || direction < WMSZ_LEFT || direction > WMSZ_BOTTOMRIGHT ||
      std::floor(direction) != direction)
    return fail(env, "Invalid resize direction");
  DWORD_PTR enabled = 0;
  POINT point{};
  bool accepted = false;
  if (GetWindowSubclass(hwnd, frameProc, frameId, &enabled) && enabled &&
      IsWindowVisible(hwnd) && !IsIconic(hwnd) && !IsZoomed(hwnd) &&
      (GetAsyncKeyState(VK_LBUTTON) & 0x8000) && GetCursorPos(&point)) {
    // No JS resize loop: Windows handles capture, bounds, min/max sizes and DPI.
    const auto hit = HTLEFT + static_cast<WPARAM>(direction) - WMSZ_LEFT;
    accepted = resizeMessage && PostMessageW(hwnd, resizeMessage, hit,
                                             MAKELPARAM(point.x, point.y)) != FALSE;
  }
  napi_value result;
  napi_get_boolean(env, accepted, &result);
  return result;
}
