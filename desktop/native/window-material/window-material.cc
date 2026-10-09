#include <node_api.h>
#include <windows.h>
#include <delayimp.h>
#include <dwmapi.h>
#include <commctrl.h>
#include <cstring>

napi_value configureFloatingFrame(napi_env env, napi_callback_info info);
napi_value beginFloatingResize(napi_env env, napi_callback_info info);

// Electron exports Node-API from the loading executable. Do not load node.exe as a DLL.
static FARPROC WINAPI nodeApiHost(unsigned event, PDelayLoadInfo info) {
  if (event == dliNotePreLoadLibrary && _stricmp(info->szDll, "node.exe") == 0)
    return reinterpret_cast<FARPROC>(GetModuleHandleW(nullptr));
  return nullptr;
}
decltype(__pfnDliNotifyHook2) __pfnDliNotifyHook2 = nodeApiHost;

// Main windows use Electron's Win11 API. Floating windows need a clipped accent
// surface so their transparent shadow gutter remains outside the native backdrop.
struct AccentPolicy { int state; int flags; DWORD gradient; int animation; };
struct CompositionAttributeData { int attribute; void* data; SIZE_T size; };
using SetComposition = BOOL(WINAPI*)(HWND, CompositionAttributeData*);
static SetComposition setComposition = reinterpret_cast<SetComposition>(
  GetProcAddress(GetModuleHandleW(L"user32.dll"), "SetWindowCompositionAttribute"));
// Win10 applies AccentPolicy to the invisible resize frame as well. Its accent
// rectangle uses physical pixels relative to the HWND, not client coordinates.
// DwmpUpdateAccentBlurRect is optional on this pre-Win11-22H2 compatibility path.
using UpdateAccentRect = HRESULT(WINAPI*)(HWND, const RECT*);
static UpdateAccentRect updateAccentRect = reinterpret_cast<UpdateAccentRect>(
  GetProcAddress(GetModuleHandleW(L"dwmapi.dll"), MAKEINTRESOURCEA(159)));
constexpr UINT_PTR accentFrameId = 0x4f4d5441;
constexpr int accentClipToRect = 1 << 9;
static bool accentBounds(HWND hwnd, RECT* bounds, int inset = 0) {
  RECT window{};
  if (!GetWindowRect(hwnd, &window) ||
      FAILED(DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, bounds, sizeof(*bounds))))
    return false;
  OffsetRect(bounds, -window.left, -window.top);
  InflateRect(bounds, -inset, -inset);
  return bounds->right > bounds->left && bounds->bottom > bounds->top;
}
static bool refreshAccentBounds(HWND hwnd, DWORD_PTR geometry) {
  const UINT dpi = GetDpiForWindow(hwnd);
  const int inset = MulDiv(static_cast<int>(geometry & 0xff), dpi, 96);
  const int radius = MulDiv(static_cast<int>((geometry >> 8) & 0xff), dpi, 96);
  RECT bounds{};
  if (IsIconic(hwnd)) return true;
  if (updateAccentRect && accentBounds(hwnd, &bounds, inset)) {
    // Acrylic ignores both DWM_BLURBEHIND regions and HWND corner cutouts.
    // Keep its rectangular surface inside the straight section of the panel.
    // The renderer paints matching, feathered edge caps over the 16-DIP corner
    // bands, preserving antialiasing and the complete CSS shadow outside them.
    bounds.top += radius;
    bounds.bottom -= radius;
    if (bounds.bottom <= bounds.top || FAILED(updateAccentRect(hwnd, &bounds))) return false;
  }
  return true;
}
static LRESULT CALLBACK accentFrameProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam,
                                       UINT_PTR id, DWORD_PTR geometry) {
  if (message == WM_NCDESTROY) RemoveWindowSubclass(hwnd, accentFrameProc, id);
  const auto result = DefSubclassProc(hwnd, message, wParam, lParam);
  if (message == WM_WINDOWPOSCHANGED || message == WM_SIZE || message == WM_DPICHANGED ||
      message == WM_DWMCOMPOSITIONCHANGED)
    refreshAccentBounds(hwnd, geometry);
  return result;
}
static void boolProp(napi_env env, napi_value result, const char* name, bool value) {
  napi_value property; napi_get_boolean(env, value, &property);
  napi_set_named_property(env, result, name, property);
}
static napi_value fail(napi_env env, const char* message) {
  napi_throw_error(env, "WINDOW_MATERIAL", message); return nullptr;
}
static bool highContrast() {
  HIGHCONTRASTW hc{sizeof(HIGHCONTRASTW), 0, nullptr};
  return SystemParametersInfoW(SPI_GETHIGHCONTRAST, sizeof(hc), &hc, 0) && (hc.dwFlags & HCF_HIGHCONTRASTON);
}
static bool transparencyEnabled() {
  DWORD enabled = 1, size = sizeof(enabled);
  const auto code = RegGetValueW(HKEY_CURRENT_USER,
    L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
    L"EnableTransparency", RRF_RT_REG_DWORD, nullptr, &enabled, &size);
  return code != ERROR_SUCCESS || enabled != 0;
}
static napi_value status(napi_env env, napi_callback_info) {
  napi_value result; napi_create_object(env, &result);
  BOOL composition = FALSE;
  const auto hr = DwmIsCompositionEnabled(&composition);
  boolProp(env, result, "available", setComposition != nullptr && SUCCEEDED(hr) && composition);
  boolProp(env, result, "highContrast", highContrast());
  boolProp(env, result, "transparencyEnabled", transparencyEnabled());
  boolProp(env, result, "roundedRegions", updateAccentRect != nullptr);
  return result;
}
static napi_value apply(napi_env env, napi_callback_info info) {
  size_t count = 5; napi_value args[5];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (count != 3 && count != 5)
    return fail(env, "Expected window handle, accent mode, ABGR tint and optional inset/radius");
  bool buffer = false; napi_is_buffer(env, args[0], &buffer);
  if (!buffer) return fail(env, "Window handle must be a Buffer");
  void* bytes = nullptr; size_t length = 0;
  napi_get_buffer_info(env, args[0], &bytes, &length);
  if (length != sizeof(HWND)) return fail(env, "Invalid window handle size");
  HWND hwnd = nullptr; std::memcpy(&hwnd, bytes, sizeof(hwnd));
  DWORD owner = 0;
  if (!IsWindow(hwnd) || GetWindowThreadProcessId(hwnd, &owner) != GetCurrentThreadId() ||
      owner != GetCurrentProcessId())
    return fail(env, "Only windows owned by this application may be changed");
  int32_t mode = 0; uint32_t tint = 0;
  if (napi_get_value_int32(env, args[1], &mode) != napi_ok ||
      napi_get_value_uint32(env, args[2], &tint) != napi_ok || (mode != 0 && mode != 3 && mode != 4))
    return fail(env, "Unsupported accent mode or tint");
  if (!setComposition) return fail(env, "Native material API is unavailable");
  if (mode && (highContrast() || !transparencyEnabled())) return fail(env, "Transparency is disabled by the system");
  int32_t inset = 0, radius = 0;
  if (count == 5 && (napi_get_value_int32(env, args[3], &inset) != napi_ok ||
      napi_get_value_int32(env, args[4], &radius) != napi_ok ||
      inset < 0 || inset > 32 || radius < 0 || radius > 64))
    return fail(env, "Invalid floating material geometry");
  const DWORD_PTR geometry = static_cast<DWORD_PTR>(inset | (radius << 8));
  if (geometry && !updateAccentRect) return fail(env, "Floating material clipping is unavailable");
  // An explicit zero-inset/radius main surface uses an alpha-capable Electron
  // window. Restore DWM's shadow without adding an invisible resize frame or
  // changing its client bounds. Floating panels keep their existing CSS shadow.
  if (count == 5 && !geometry) {
    const DWMNCRENDERINGPOLICY policy = DWMNCRP_ENABLED;
    if (FAILED(DwmSetWindowAttribute(hwnd, DWMWA_NCRENDERING_POLICY, &policy, sizeof(policy))))
      return fail(env, "Could not enable the main window shadow");
    const MARGINS margins{1, 1, 1, 1};
    if (FAILED(DwmExtendFrameIntoClientArea(hwnd, &margins)))
      return fail(env, "Could not extend the main window shadow frame");
  }
  RECT bounds{};
  const bool clip = mode && updateAccentRect && accentBounds(hwnd, &bounds);
  AccentPolicy accent{mode, 2 | (clip ? accentClipToRect : 0), tint, 0};
  CompositionAttributeData data{19, &accent, sizeof(accent)};
  const BOOL accepted = setComposition(hwnd, &data);
  if (accepted && mode && (clip || geometry)) {
    if (!refreshAccentBounds(hwnd, geometry) ||
        !SetWindowSubclass(hwnd, accentFrameProc, accentFrameId, geometry))
      return fail(env, "Could not clip the native material to the visible window frame");
  } else if (!mode) {
    RemoveWindowSubclass(hwnd, accentFrameProc, accentFrameId);
    DWM_BLURBEHIND blur{DWM_BB_ENABLE, FALSE, nullptr, FALSE};
    DwmEnableBlurBehindWindow(hwnd, &blur);
  }
  napi_value result; napi_create_object(env, &result);
  boolProp(env, result, "accepted", accepted != FALSE);
  return result;
}
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"status", nullptr, status, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"apply", nullptr, apply, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setFloatingFrame", nullptr, configureFloatingFrame, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"beginFloatingResize", nullptr, beginFloatingResize, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
NAPI_MODULE(window_material, init)
