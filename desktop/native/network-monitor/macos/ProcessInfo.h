#include <stdint.h>
#include <stdbool.h>
#include <sys/types.h>
typedef struct {
  int32_t pid, parent;
  uint32_t uid, version;
  uint64_t birthMicros;
  char path[4096];
  char entry[4096];
} OMTProcessInfo;
bool omt_process_info(int32_t pid, OMTProcessInfo *result);
bool omt_audit_process(const void *token, size_t size, OMTProcessInfo *result);
bool omt_audit_has_uid(const void *token, size_t size, uint32_t uid);
int omt_process_list(int32_t *buffer, int capacity);
bool omt_process_matches(int32_t pid, uint64_t birthMicros);
