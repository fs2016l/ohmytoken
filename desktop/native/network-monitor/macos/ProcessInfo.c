#include "ProcessInfo.h"
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/sysctl.h>
#include <bsm/libbsm.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

static void entry_point(int32_t pid, OMTProcessInfo *result) {
  const char *base = strrchr(result->path, '/'); base = base ? base + 1 : result->path;
  if (strcmp(base,"node") && strcmp(base,"nodejs") && strcmp(base,"bun") && strcmp(base,"deno") && strncmp(base,"python",6) && strncmp(base,"pypy",4)) return;
  int mib[] = { CTL_KERN, KERN_PROCARGS2, pid };
  size_t size = 0;
  if (sysctl(mib,3,NULL,&size,NULL,0) || size < sizeof(int) || size > 128 * 1024) return;
  char *buffer = calloc(1,size);
  if (!buffer) return;
  if (sysctl(mib,3,buffer,&size,NULL,0)) { free(buffer); return; }
  int argc = 0; memcpy(&argc,buffer,sizeof(argc));
  char *cursor = buffer + sizeof(int), *end = buffer + size;
  while(cursor < end && *cursor) cursor++; // executable image path
  while(cursor < end && !*cursor) cursor++;
  bool skip = false;
  for (int i=0; i<argc && cursor<end; i++) {
    size_t length = strnlen(cursor,(size_t)(end-cursor));
    if (length >= (size_t)(end-cursor)) break;
    const char *argument=cursor;cursor+=length+1;
    if (!i || skip) {skip=false;continue;}
    if (!strncmp(argument,"-e",2) || !strncmp(argument,"-c",2) || !strncmp(argument,"-p",2) || !strncmp(argument,"--eval",6) || !strncmp(argument,"--print",7) || !strcmp(argument,"-")) break;
    if (!strcmp(argument,"-m") && cursor<end) {
      size_t moduleLength=strnlen(cursor,(size_t)(end-cursor));
      if(moduleLength && moduleLength<sizeof(result->entry)-8 && moduleLength<(size_t)(end-cursor)) {
        bool valid=true;
        for(size_t j=0;j<moduleLength;j++) if(!isalnum((unsigned char)cursor[j]) && cursor[j]!='_' && cursor[j]!='.' && cursor[j]!='-') valid=false;
        if(valid){strlcpy(result->entry,"module:",sizeof(result->entry));strlcat(result->entry,cursor,sizeof(result->entry));}
      }
      break;
    }
    if(!strcmp(argument,"--require") || !strcmp(argument,"-r") || !strcmp(argument,"--import") || !strcmp(argument,"--loader") || !strcmp(argument,"--conditions") || !strcmp(argument,"--title") || !strcmp(argument,"--env-file") || !strcmp(argument,"--env-file-if-exists") || !strcmp(argument,"-W") || !strcmp(argument,"-X")){skip=true;continue;}
    if(argument[0]=='-') {
      const char *flags[]={"--","--no-warnings","--enable-source-maps","--experimental-strip-types","--inspect","--inspect-brk","--preserve-symlinks","--preserve-symlinks-main","--no-deprecation","--trace-warnings","-u","-B","-E","-I","-O","-OO","-q","-s","-S","-v","-b","-bb","-x"};
      bool known=strchr(argument,'=')!=NULL;
      for(size_t j=0;j<sizeof(flags)/sizeof(flags[0]);j++)if(!strcmp(argument,flags[j]))known=true;
      if(known)continue;
      break; // Unknown option arity must not expose an option value as an entry point.
    }
    if((!strcmp(base,"bun") || !strcmp(base,"deno")) && !strcmp(argument,"run"))continue;
    // Only the first script path is retained. Program arguments and environment
    // variables never leave this temporary buffer.
    if(argument[0]=='/' && length<sizeof(result->entry))strlcpy(result->entry,argument,sizeof(result->entry));
    break;
  }
  explicit_bzero(buffer,size);free(buffer);
}
bool omt_process_info(int32_t pid, OMTProcessInfo *result) {
  struct proc_bsdinfo info={0};struct proc_uniqidentifierinfo identity={0};
  if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info))!=(int)sizeof(info))return false;
  if(proc_pidinfo(pid,PROC_PIDUNIQIDENTIFIERINFO,0,&identity,sizeof(identity))!=(int)sizeof(identity))return false;
  memset(result,0,sizeof(*result));
  if(proc_pidpath(pid,result->path,sizeof(result->path))<=0)return false;
  result->pid=pid;result->parent=(int32_t)info.pbi_ppid;result->uid=info.pbi_uid;result->version=identity.p_idversion;
  result->birthMicros=info.pbi_start_tvsec*1000000ULL+info.pbi_start_tvusec;
  entry_point(pid,result);return true;
}
bool omt_audit_process(const void *data, size_t size, OMTProcessInfo *result) {
  if(size!=sizeof(audit_token_t))return false;
  audit_token_t token;memcpy(&token,data,size);
  if(!omt_process_info(audit_token_to_pid(token),result))return false;
  return result->version==(uint32_t)audit_token_to_pidversion(token);
}
bool omt_audit_has_uid(const void *data, size_t size, uint32_t uid) {
  if(size!=sizeof(audit_token_t))return false;
  audit_token_t token;memcpy(&token,data,size);
  return audit_token_to_euid(token)==uid;
}
int omt_process_list(int32_t *buffer, int capacity) {
  if(capacity<1)return 0;
  int bytes=proc_listpids(PROC_ALL_PIDS,0,buffer,capacity*(int)sizeof(int32_t));
  return bytes>0?bytes/(int)sizeof(int32_t):0;
}
bool omt_process_matches(int32_t pid, uint64_t birthMicros) {
  struct proc_bsdinfo info={0};
  return proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info))==(int)sizeof(info) &&
    info.pbi_start_tvsec*1000000ULL+info.pbi_start_tvusec==birthMicros;
}
