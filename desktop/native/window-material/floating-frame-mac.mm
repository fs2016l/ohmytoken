#include <node_api.h>
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <cmath>
#include <cstring>
#include "floating-resize-geometry.h"

@interface OMTFloatingFrame : NSObject
@property(nonatomic, weak) NSWindow* window;
@property(nonatomic) BOOL enabled;
@property(nonatomic) BOOL mouseDown;
@property(nonatomic) BOOL resizing;
@property(nonatomic) int direction;
@property(nonatomic) NSPoint startPoint;
@property(nonatomic) NSRect startFrame;
@property(nonatomic, strong) id monitor;
- (instancetype)initWithWindow:(NSWindow*)window;
- (NSEvent*)handleEvent:(NSEvent*)event;
- (void)updateAt:(NSPoint)point;
- (BOOL)begin:(int)direction;
- (void)finish:(BOOL)cancel;
- (void)invalidate;
@end

@implementation OMTFloatingFrame
- (instancetype)initWithWindow:(NSWindow*)window {
  if ((self = [super init])) {
    _window = window;
    __weak OMTFloatingFrame* weakSelf = self;
    // App-local events need no accessibility/input-monitoring permission. AppKit keeps
    // delivering the drag to its original window even after the pointer leaves it.
    _monitor = [NSEvent addLocalMonitorForEventsMatchingMask:
        NSEventMaskLeftMouseDown | NSEventMaskLeftMouseDragged |
        NSEventMaskLeftMouseUp | NSEventMaskKeyDown
      handler:^NSEvent*(NSEvent* event) {
        OMTFloatingFrame* frame = weakSelf;
        return frame ? [frame handleEvent:event] : event;
      }];
    NSNotificationCenter* center = NSNotificationCenter.defaultCenter;
    [center addObserver:self selector:@selector(closing:) name:NSWindowWillCloseNotification object:window];
    [center addObserver:self selector:@selector(interrupted:) name:NSWindowDidResignKeyNotification object:window];
    [center addObserver:self selector:@selector(interrupted:) name:NSApplicationDidResignActiveNotification object:nil];
  }
  return self;
}
- (void)setEnabled:(BOOL)enabled {
  _enabled = enabled;
  if (!enabled) [self finish:NO];
  // The renderer owns the six-point band around the visible panel. Disable the
  // system's unrelated resize band at the outside of the transparent shadow gutter.
  self.window.styleMask &= ~NSWindowStyleMaskResizable;
}
- (void)updateAt:(NSPoint)point {
  NSWindow* window = self.window;
  if (!self.resizing || !window || !window.visible) return;
  NSRect start = self.startFrame;
  NSSize minimum = window.minSize;
  NSSize maximum = window.maxSize;
  auto next = floating_resize::drag(
      {start.origin.x, start.origin.y, start.size.width, start.size.height}, self.direction,
      point.x - self.startPoint.x, point.y - self.startPoint.y,
      minimum.width, minimum.height, maximum.width, maximum.height);
  [window setFrame:NSMakeRect(next.x, next.y, next.width, next.height) display:YES];
}
- (NSEvent*)handleEvent:(NSEvent*)event {
  NSWindow* window = self.window;
  if (!window) return event;
  if (event.type == NSEventTypeLeftMouseDown) {
    [self finish:NO];
    self.mouseDown = self.enabled && event.window == window && window.visible;
    if (self.mouseDown) {
      self.startPoint = [window convertPointToScreen:event.locationInWindow];
      self.startFrame = window.frame;
    }
  } else if (event.type == NSEventTypeLeftMouseUp) {
    if (self.resizing && event.window)
      [self updateAt:[event.window convertPointToScreen:event.locationInWindow]];
    [self finish:NO];
  } else if (self.resizing && event.type == NSEventTypeLeftMouseDragged) {
    if (event.window) [self updateAt:[event.window convertPointToScreen:event.locationInWindow]];
    return nil;
  } else if (self.resizing && event.type == NSEventTypeKeyDown && event.keyCode == 53) {
    [self finish:YES];
    return nil;
  }
  return event;
}
- (BOOL)begin:(int)direction {
  if (!self.enabled || !self.mouseDown || self.resizing || !self.window.visible) return NO;
  self.direction = direction;
  self.resizing = YES;
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowWillStartLiveResizeNotification object:self.window];
  return YES;
}
- (void)finish:(BOOL)cancel {
  self.mouseDown = NO;
  if (!self.resizing) return;
  self.resizing = NO;
  NSWindow* window = self.window;
  if (!window) return;
  if (cancel) [window setFrame:self.startFrame display:YES];
  // Electron uses this notification for its `resized` event, persisting bounds
  // and reanchoring an edge-docked window only when the drag has finished.
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowDidEndLiveResizeNotification object:window];
}
- (void)interrupted:(NSNotification*)notification {
  (void)notification;
  [self finish:NO];
}
- (void)closing:(NSNotification*)notification {
  (void)notification;
  // Electron may already be disposing its window delegate; do not publish another resize.
  self.resizing = NO;
  self.mouseDown = NO;
  [self invalidate];
}
- (void)invalidate {
  [self finish:NO];
  if (_monitor) {
    [NSEvent removeMonitor:_monitor];
    _monitor = nil;
  }
  [NSNotificationCenter.defaultCenter removeObserver:self];
}
- (void)dealloc {
  if (_monitor) [NSEvent removeMonitor:_monitor];
  [NSNotificationCenter.defaultCenter removeObserver:self];
}
@end

namespace {
char frameKey;
napi_value fail(napi_env env, const char* message) {
  napi_throw_error(env, "FLOATING_FRAME", message);
  return nullptr;
}
bool containsView(NSView* view, const void* pointer) {
  if ((__bridge const void*)view == pointer) return true;
  for (NSView* child in view.subviews)
    if (containsView(child, pointer)) return true;
  return false;
}
NSWindow* windowForHandle(napi_env env, napi_value value) {
  bool buffer = false;
  napi_is_buffer(env, value, &buffer);
  if (!buffer) return nil;
  void* data = nullptr;
  size_t length = 0;
  napi_get_buffer_info(env, value, &data, &length);
  if (length != sizeof(void*)) return nil;
  void* pointer = nullptr;
  std::memcpy(&pointer, data, length);
  // Never dereference an arbitrary/stale pointer supplied over Node-API.
  for (NSWindow* window in NSApp.windows) {
    NSView* root = window.contentView.superview ?: window.contentView;
    if (root && containsView(root, pointer)) return window;
  }
  return nil;
}
bool integer(napi_env env, napi_value value, int minimum, int maximum, int* result) {
  double number = 0;
  if (napi_get_value_double(env, value, &number) != napi_ok || !std::isfinite(number) ||
      std::floor(number) != number || number < minimum || number > maximum) return false;
  *result = static_cast<int>(number);
  return true;
}
}

napi_value setFloatingFrameMac(napi_env env, napi_callback_info info) {
  if (!NSThread.isMainThread) return fail(env, "Floating frame requires the main thread");
  size_t count = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (count != 3) return fail(env, "Expected window handle, inset and enabled flag");
  NSWindow* window = windowForHandle(env, args[0]);
  if (!window) return fail(env, "Invalid window handle");
  int inset = 0;
  bool enabled = false;
  if (!integer(env, args[1], 1, 32, &inset)) return fail(env, "Invalid floating inset");
  if (napi_get_value_bool(env, args[2], &enabled) != napi_ok) return fail(env, "Invalid enabled flag");
  OMTFloatingFrame* frame = objc_getAssociatedObject(window, &frameKey);
  if (!frame) {
    frame = [[OMTFloatingFrame alloc] initWithWindow:window];
    objc_setAssociatedObject(window, &frameKey, frame, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  frame.enabled = enabled;
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value beginFloatingResizeMac(napi_env env, napi_callback_info info) {
  if (!NSThread.isMainThread) return fail(env, "Floating resize requires the main thread");
  size_t count = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (count != 2) return fail(env, "Expected window handle and resize direction");
  NSWindow* window = windowForHandle(env, args[0]);
  if (!window) return fail(env, "Invalid window handle");
  int direction = 0;
  if (!integer(env, args[1], 1, 8, &direction)) return fail(env, "Invalid resize direction");
  OMTFloatingFrame* frame = objc_getAssociatedObject(window, &frameKey);
  napi_value result;
  napi_get_boolean(env, [frame begin:direction], &result);
  return result;
}
