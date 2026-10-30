#pragma once
#include <algorithm>

namespace floating_resize {
struct Rect { double x, y, width, height; };

// AppKit screen points: the origin is at the bottom left, independent of Retina scale.
inline Rect drag(Rect start, int direction, double dx, double dy,
                 double minWidth, double minHeight, double maxWidth, double maxHeight) {
  const bool left = direction == 1 || direction == 4 || direction == 7;
  const bool right = direction == 2 || direction == 5 || direction == 8;
  const bool top = direction == 3 || direction == 4 || direction == 5;
  const bool bottom = direction == 6 || direction == 7 || direction == 8;
  Rect result = start;
  if (left || right) {
    result.width = std::clamp(start.width + (left ? -dx : dx),
                              minWidth, std::max(minWidth, maxWidth));
    if (left) result.x = start.x + start.width - result.width;
  }
  if (top || bottom) {
    result.height = std::clamp(start.height + (bottom ? -dy : dy),
                               minHeight, std::max(minHeight, maxHeight));
    if (bottom) result.y = start.y + start.height - result.height;
  }
  return result;
}
}
