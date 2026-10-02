/* GraphMind trace runtime for C, prepended to the instrumented program. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static FILE *__gm_f;
static long long __gm_steps, __gm_max = 5000;
static int __gm_counting, __gm_finished, __gm_ready, __gm_first, __gm_depth;
static const char *__gm_stack[256];
static const void *__gm_reg_ptr[64];
static long __gm_reg_len[64];
static int __gm_reg_next;

/* Arrays recorded with a known length are remembered so pointer parameters can find their length. */
static void __gm_register(const void *p, long len) {
    int i;
    for (i = 0; i < 64; i++) if (__gm_reg_ptr[i] == p) { __gm_reg_len[i] = len; return; }
    __gm_reg_ptr[__gm_reg_next] = p; __gm_reg_len[__gm_reg_next] = len; __gm_reg_next = (__gm_reg_next + 1) % 64;
}
static long __gm_lookup(const void *p) {
    int i;
    for (i = 0; i < 64; i++) if (p && __gm_reg_ptr[i] == p) return __gm_reg_len[i];
    return -1;
}

static void __gm_finish(int limited) {
    if (__gm_finished) return;
    __gm_finished = 1;
    if (__gm_f) { fprintf(__gm_f, "{\"done\":true,\"steps\":%lld,\"limited\":%s}\n", __gm_steps, limited ? "true" : "false"); fflush(__gm_f); }
}
static void __gm_at_exit(void) { __gm_finish(0); }
static void __gm_init(void) {
    const char *path, *max;
    if (__gm_ready) return;
    __gm_ready = 1;
    path = getenv("GM_TRACE");
    max = getenv("GM_MAX");
    __gm_counting = getenv("GM_COUNT") && strcmp(getenv("GM_COUNT"), "1") == 0;
    if (max) __gm_max = atoll(max);
    if (path) __gm_f = fopen(path, "w");
    atexit(__gm_at_exit);
}
static void __gm_str(const char *s, long max) {
    long i;
    if (!s) { fputs("null", __gm_f); return; }
    fputc('"', __gm_f);
    for (i = 0; i < max && i < 200 && s[i]; i++) {
        unsigned char c = (unsigned char)s[i];
        if (c == '"' || c == '\\') { fputc('\\', __gm_f); fputc(c, __gm_f); }
        else if (c < 0x20) fprintf(__gm_f, "\\u%04x", c);
        else fputc(c, __gm_f);
    }
    fputc('"', __gm_f);
}
static int __gm_begin(int line, int kind) {
    int i;
    __gm_init();
    if (++__gm_steps > __gm_max) { __gm_finish(1); fflush(stdout); exit(0); }
    if (__gm_counting || !__gm_f) return 0;
    fprintf(__gm_f, "{\"l\":%d,\"k\":%d,\"s\":[", line, kind);
    for (i = 0; i < __gm_depth && i < 256; i++) { if (i) fputc(',', __gm_f); __gm_str(__gm_stack[i], 200); }
    fputs("],\"v\":{", __gm_f);
    __gm_first = 1;
    return 1;
}
static void __gm_end(void) { fputs("}}\n", __gm_f); fflush(__gm_f); }
static void __gm_key(const char *name) { if (!__gm_first) fputc(',', __gm_f); __gm_first = 0; __gm_str(name, 200); fputc(':', __gm_f); }
static void __gm_num(double v) {
    if (v != v || v > 1e300 || v < -1e300) fputs("null", __gm_f);
    else fprintf(__gm_f, "%.10g", v);
}
static void __gm_i(const char *name, long long v) { __gm_key(name); fprintf(__gm_f, "%lld", v); }
static void __gm_d(const char *name, double v) { __gm_key(name); __gm_num(v); }
static void __gm_c(const char *name, char v) { char s[2] = { v, 0 }; __gm_key(name); __gm_str(s, 1); }
static void __gm_s(const char *name, const char *s, long max) { __gm_key(name); __gm_str(s, max); }

#define __GM_ARRAY(fn, T, put) \
static void fn(const char *name, const T *a, long len) { long i; __gm_register(a, len); __gm_key(name); fputc('[', __gm_f); \
    for (i = 0; i < len && i < 200; i++) { if (i) fputc(',', __gm_f); put; } fputc(']', __gm_f); } \
static void fn##p(const char *name, const T *a) { long len = __gm_lookup(a); if (len >= 0) fn(name, a, len); } \
static void fn##2(const char *name, const T *a, long rows, long cols) { long r, c; __gm_key(name); fputc('[', __gm_f); \
    for (r = 0; r < rows && r < 50; r++) { if (r) fputc(',', __gm_f); fputc('[', __gm_f); \
        for (c = 0; c < cols && c < 50; c++) { long i = r * cols + c; if (c) fputc(',', __gm_f); put; } fputc(']', __gm_f); } fputc(']', __gm_f); }
__GM_ARRAY(__gm_ai, int, fprintf(__gm_f, "%d", a[i]))
__GM_ARRAY(__gm_al, long, fprintf(__gm_f, "%ld", a[i]))
__GM_ARRAY(__gm_all, long long, fprintf(__gm_f, "%lld", a[i]))
__GM_ARRAY(__gm_au, unsigned, fprintf(__gm_f, "%u", a[i]))
__GM_ARRAY(__gm_ah, short, fprintf(__gm_f, "%d", a[i]))
__GM_ARRAY(__gm_ad, double, __gm_num(a[i]))
__GM_ARRAY(__gm_af, float, __gm_num(a[i]))
__GM_ARRAY(__gm_ab, _Bool, fputs(a[i] ? "true" : "false", __gm_f))

static int __gm_n(void) { const char *v = getenv("GM_N"); return v ? atoi(v) : 0; }
static int __gm_enter(const char *name) { __gm_init(); if (__gm_depth < 256) __gm_stack[__gm_depth] = name; __gm_depth++; return 0; }
static void __gm_exit(int *unused) { (void)unused; if (__gm_depth > 0) __gm_depth--; }
#define __GM_SCOPE(name) int __gm_scope __attribute__((cleanup(__gm_exit), unused)) = __gm_enter(name)
