#pragma once
#include <algorithm>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace omt {
// Keep failed process-start metadata separate from observed network loss.
// A failed identity read alone says nothing about whether that process sent data.
class IdentityGaps {
  struct Entry {
    std::string parent;
    uint64_t start = 0, end = 0;
  };
  std::unordered_map<uint32_t, std::vector<Entry>> entries;
  size_t count = 0;
 public:
  bool remember(uint32_t pid, const std::string& parent, uint64_t at) {
    if (parent.empty()) return true;
    if (count >= 20000) return false;
    auto& rows = entries[pid];
    if (rows.size() >= 8) return false;
    end(pid, at);
    rows.push_back({parent, at, 0});
    ++count;
    return true;
  }
  void end(uint32_t pid, uint64_t at) {
    const auto found = entries.find(pid);
    if (found == entries.end()) return;
    for (auto& row : found->second) if (!row.end && row.start <= at) row.end = at;
  }
  std::string parent(uint32_t pid, uint64_t at) const {
    const auto found = entries.find(pid);
    if (found == entries.end()) return {};
    std::string parent;
    for (const auto& row : found->second) {
      if (row.start > at || (row.end && row.end < at)) continue;
      if (!parent.empty()) return {}; // Reused PID at a timestamp boundary is ambiguous.
      parent = row.parent;
    }
    return parent;
  }
  void prune(uint64_t at) {
    for (auto it = entries.begin(); it != entries.end();) {
      const auto size = it->second.size();
      std::erase_if(it->second, [at](const Entry& row) { return row.end && at > row.end && at - row.end > 60000; });
      count -= size - it->second.size();
      if (it->second.empty()) it = entries.erase(it); else ++it;
    }
  }
};
}
