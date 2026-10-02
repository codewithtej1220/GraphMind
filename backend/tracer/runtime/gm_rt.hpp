// GraphMind trace runtime for C++, prepended to the instrumented program.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <string_view>
#include <type_traits>
#include <iterator>
#include <utility>
#include <vector>

namespace gmrt {
inline FILE *f = nullptr;
inline long long steps = 0, max_steps = 5000;
inline bool counting = false, finished = false, ready = false;
inline const char *stack[256];
inline int depth = 0;
inline std::string line;
inline const void *reg_ptr[64];
inline long long reg_len[64];
inline int reg_next = 0;

// Arrays recorded with a known length are remembered so pointer parameters can find their length.
inline void reg(const void *p, long long len) {
    for (int i = 0; i < 64; i++) if (reg_ptr[i] == p) { reg_len[i] = len; return; }
    reg_ptr[reg_next] = p; reg_len[reg_next] = len; reg_next = (reg_next + 1) % 64;
}
inline long long lookup(const void *p) {
    for (int i = 0; i < 64; i++) if (p && reg_ptr[i] == p) return reg_len[i];
    return -1;
}

inline void finish(bool limited) {
    if (finished) return;
    finished = true;
    if (f) { std::fprintf(f, "{\"done\":true,\"steps\":%lld,\"limited\":%s}\n", steps, limited ? "true" : "false"); std::fflush(f); }
}
inline void init() {
    if (ready) return;
    ready = true;
    const char *path = std::getenv("GM_TRACE");
    const char *max = std::getenv("GM_MAX");
    const char *count = std::getenv("GM_COUNT");
    counting = count && std::strcmp(count, "1") == 0;
    if (max) max_steps = std::atoll(max);
    if (path) f = std::fopen(path, "w");
    std::atexit([] { finish(false); });
}

template <class T, class = void> struct iterable : std::false_type {};
template <class T> struct iterable<T, std::void_t<decltype(std::begin(std::declval<const T &>())), decltype(std::end(std::declval<const T &>()))>> : std::true_type {};
template <class T> struct is_pair : std::false_type {};
template <class A, class B> struct is_pair<std::pair<A, B>> : std::true_type {};

inline void str(std::string &o, std::string_view s) {
    o += '"';
    std::size_t n = 0;
    for (char ch : s) {
        if (n++ >= 200) break;
        unsigned char c = static_cast<unsigned char>(ch);
        if (c == '"' || c == '\\') { o += '\\'; o += ch; }
        else if (c < 0x20) { char buf[8]; std::snprintf(buf, sizeof buf, "\\u%04x", c); o += buf; }
        else o += ch;
    }
    o += '"';
}

template <class T> void enc(std::string &o, const T &v, int d);

template <class T> void enc_range(std::string &o, const T &v, int d) {
    if (d > 3) { o += "\"...\""; return; }
    o += '[';
    int n = 0;
    for (const auto &e : v) {
        if (n >= 200) break;
        if (n++) o += ',';
        enc(o, e, d + 1);
    }
    o += ']';
}

template <class T> void enc(std::string &o, const T &v, int d) {
    using U = std::remove_cv_t<std::remove_reference_t<T>>;
    if constexpr (std::is_array_v<U> && std::is_same_v<std::remove_cv_t<std::remove_extent_t<U>>, char>) {
        str(o, std::string_view(v, strnlen(v, std::extent_v<U>)));
    } else if constexpr (std::is_array_v<U>) {
        enc_range(o, v, d);
    } else if constexpr (std::is_same_v<U, bool>) {
        o += v ? "true" : "false";
    } else if constexpr (std::is_same_v<U, char>) {
        str(o, std::string_view(&v, 1));
    } else if constexpr (std::is_floating_point_v<U>) {
        double x = static_cast<double>(v);
        if (x != x || x > 1e300 || x < -1e300) { o += "null"; return; }
        char buf[40]; std::snprintf(buf, sizeof buf, "%.10g", x); o += buf;
    } else if constexpr (std::is_integral_v<U> && std::is_signed_v<U>) {
        o += std::to_string(static_cast<long long>(v));
    } else if constexpr (std::is_integral_v<U>) {
        o += std::to_string(static_cast<unsigned long long>(v));
    } else if constexpr (std::is_enum_v<U>) {
        o += std::to_string(static_cast<long long>(v));
    } else if constexpr (std::is_same_v<U, const char *> || std::is_same_v<U, char *>) {
        if (v) str(o, std::string_view(v)); else o += "null";
    } else if constexpr (std::is_convertible_v<const U &, std::string_view>) {
        str(o, std::string_view(v));
    } else if constexpr (is_pair<U>::value) {
        o += '['; enc(o, v.first, d + 1); o += ','; enc(o, v.second, d + 1); o += ']';
    } else if constexpr (iterable<U>::value) {
        enc_range(o, v, d);
    } else {
        o += "\"?\"";
    }
}

inline bool first = true;
inline bool begin(int ln, int kind) {
    init();
    if (++steps > max_steps) { finish(true); std::fflush(stdout); std::exit(0); }
    if (counting || !f) return false;
    line.clear();
    line += "{\"l\":"; line += std::to_string(ln); line += ",\"k\":"; line += std::to_string(kind); line += ",\"s\":[";
    for (int i = 0; i < depth && i < 256; i++) { if (i) line += ','; str(line, stack[i]); }
    line += "],\"v\":{";
    first = true;
    return true;
}
template <class T> void var(const char *name, const T &v) {
    if (!first) line += ',';
    first = false;
    str(line, name);
    line += ':';
    enc(line, v, 0);
}
template <class T> void arr(const char *name, const T *a, long long len) {
    reg(a, len);
    if (!first) line += ',';
    first = false;
    str(line, name);
    line += ":[";
    for (long long i = 0; a && i < len && i < 200; i++) { if (i) line += ','; enc(line, a[i], 1); }
    line += ']';
}
template <class T> void arr2(const char *name, const T *a, long long rows, long long cols) {
    if (!first) line += ',';
    first = false;
    str(line, name);
    line += ":[";
    for (long long r = 0; a && r < rows && r < 50; r++) {
        if (r) line += ',';
        line += '[';
        for (long long c = 0; c < cols && c < 50; c++) { if (c) line += ','; enc(line, a[r * cols + c], 2); }
        line += ']';
    }
    line += ']';
}
template <class T> void ptr(const char *name, const T *a) {
    long long len = lookup(a);
    if (len >= 0) arr(name, a, len);
}
inline void end() { line += "}}\n"; std::fputs(line.c_str(), f); std::fflush(f); }

inline int n() { const char *v = std::getenv("GM_N"); return v ? std::atoi(v) : 0; }
// Converts to any std::vector<T>, so `std::vector<long> v = gmrt::data();` works too.
struct Data {
    template <class T> operator std::vector<T>() const {
        const char *sorted = std::getenv("GM_SORTED");
        bool ascending = sorted && sorted[0] == '1';
        std::vector<T> out;
        for (int i = 0; i < n(); i++) out.push_back(static_cast<T>(ascending ? i * 3 + 1 : (i * 7919 + 13) % 1000));
        return out;
    }
};
inline Data data() { return {}; }

struct Scope {
    explicit Scope(const char *name) { init(); if (depth < 256) stack[depth] = name; depth++; }
    ~Scope() { if (depth > 0) depth--; }
};
}  // namespace gmrt
