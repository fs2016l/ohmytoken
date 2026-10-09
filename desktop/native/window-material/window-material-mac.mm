#include <node_api.h>
#import <AppKit/AppKit.h>
#include <cstring>

namespace {
napi_value fail(napi_env env, const char* message) {
  napi_throw_error(env, "WINDOW_MATERIAL", message);
  return nullptr;
}
void boolProp(napi_env env, napi_value object, const char* name, bool value) {
  napi_value property;
  napi_get_boolean(env, value, &property);
  napi_set_named_property(env, object, name, property);
}
bool containsView(NSView* root, const void* pointer) {
  if ((__bridge const void*)root == pointer) return true;
  for (NSView* child in root.subviews)
    if (containsView(child, pointer)) return true;
  return false;
}
NSVisualEffectView* findVibrancy(NSView* root) {
  if ([root isKindOfClass:NSVisualEffectView.class]) {
    auto* effect = (NSVisualEffectView*)root;
    if (effect.material == NSVisualEffectMaterialUnderWindowBackground &&
        effect.blendingMode == NSVisualEffectBlendingModeBehindWindow) return effect;
  }
  for (NSView* child in root.subviews)
    if (auto* effect = findVibrancy(child)) return effect;
  return nil;
}
napi_value status(napi_env env, napi_callback_info) {
  napi_value result;
  napi_create_object(env, &result);
  boolProp(env, result, "available", true);
  boolProp(env, result, "highContrast", false);
  boolProp(env, result, "roundedRegions", true);
  return result;
}
napi_value setVibrancyGeometry(napi_env env, napi_callback_info info) {
  if (!NSThread.isMainThread) return fail(env, "Vibrancy must be masked on the main thread");
  size_t count = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (count != 3) return fail(env, "Expected window handle, panel inset and corner radius");
  bool buffer = false;
  napi_is_buffer(env, args[0], &buffer);
  if (!buffer) return fail(env, "Window handle must be a Buffer");
  void* bytes = nullptr;
  size_t length = 0;
  napi_get_buffer_info(env, args[0], &bytes, &length);
  if (length != sizeof(void*)) return fail(env, "Invalid window handle size");
  void* handle = nullptr;
  std::memcpy(&handle, bytes, sizeof(handle));
  int32_t inset = 0, radius = 0;
  if (napi_get_value_int32(env, args[1], &inset) != napi_ok ||
      napi_get_value_int32(env, args[2], &radius) != napi_ok ||
      inset < 0 || inset > 32 || radius < 0 || radius > 64)
    return fail(env, "Invalid floating material geometry");

  // Compare the handle with live application views before dereferencing it.
  // Only mask Electron's behind-window material, never the content or shadow.
  NSVisualEffectView* effect = nil;
  for (NSWindow* window in NSApp.windows) {
    NSView* root = window.contentView.superview ?: window.contentView;
    if (root && containsView(root, handle)) {
      effect = findVibrancy(root);
      break;
    }
  }
  if (!effect) return fail(env, "The application's vibrancy view is unavailable");
  const CGFloat cap = inset + radius;
  const CGFloat dimension = 2 * cap + 1;
  NSImage* mask = [NSImage imageWithSize:NSMakeSize(dimension, dimension)
                               flipped:NO
                        drawingHandler:^BOOL(NSRect rect) {
    NSGraphicsContext.currentContext.shouldAntialias = YES;
    [NSColor.whiteColor setFill];
    [[NSBezierPath bezierPathWithRoundedRect:NSInsetRect(rect, inset, inset)
                                   xRadius:radius yRadius:radius] fill];
    return YES;
  }];
  // A stretchable mask keeps a 12-point shadow gutter and 16-point corners at
  // every window size and Retina scale, without resizing the native window.
  mask.capInsets = NSEdgeInsetsMake(cap, cap, cap, cap);
  mask.resizingMode = NSImageResizingModeStretch;
  effect.maskImage = mask;
  napi_value result;
  napi_create_object(env, &result);
  boolProp(env, result, "accepted", true);
  return result;
}
}

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"status", nullptr, status, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setVibrancyGeometry", nullptr, setVibrancyGeometry, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
NAPI_MODULE(window_material, init)
