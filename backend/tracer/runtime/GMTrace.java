
final class GMTrace {
    private static final java.util.ArrayList<String> STACK = new java.util.ArrayList<>();
    private static final boolean COUNTING = "1".equals(System.getenv("GM_COUNT"));
    private static final long MAX = parseLong(System.getenv("GM_MAX"), 5000);
    private static java.io.PrintStream out;
    private static long steps;
    private static boolean finished;

    static {
        String path = System.getenv("GM_TRACE");
        try {
            if (path != null) out = new java.io.PrintStream(new java.io.BufferedOutputStream(new java.io.FileOutputStream(path), 1 << 16), false, "UTF-8");
        } catch (Exception ignored) { out = null; }
        Runtime.getRuntime().addShutdownHook(new Thread(() -> finish(false)));
    }

    private static long parseLong(String value, long fallback) {
        try { return value == null ? fallback : Long.parseLong(value.trim()); } catch (NumberFormatException e) { return fallback; }
    }

    private static synchronized void finish(boolean limited) {
        if (finished) return;
        finished = true;
        if (out != null) {
            out.print("{\"done\":true,\"steps\":" + steps + ",\"limited\":" + limited + "}\n");
            out.flush();
        }
    }

    static void enter(String name) { STACK.add(name); }
    static void exit() { if (!STACK.isEmpty()) STACK.remove(STACK.size() - 1); }
    static int n() { return (int) parseLong(System.getenv("GM_N"), 0); }

    private static long value(int i) { return "1".equals(System.getenv("GM_SORTED")) ? i * 3L + 1 : (i * 7919L + 13) % 1000; }
    static int[] dataInt() { int[] a = new int[n()]; for (int i = 0; i < a.length; i++) a[i] = (int) value(i); return a; }
    static long[] dataLong() { long[] a = new long[n()]; for (int i = 0; i < a.length; i++) a[i] = value(i); return a; }
    static double[] dataDouble() { double[] a = new double[n()]; for (int i = 0; i < a.length; i++) a[i] = value(i); return a; }
    static java.util.List<Integer> dataList() { java.util.ArrayList<Integer> a = new java.util.ArrayList<>(); for (int i = 0; i < n(); i++) a.add((int) value(i)); return a; }

    static void h(int line, int kind, Object... nameValues) {
        steps++;
        if (steps > MAX) { finish(true); System.out.flush(); System.exit(0); }
        if (COUNTING || out == null) return;
        StringBuilder b = new StringBuilder(128);
        b.append("{\"l\":").append(line).append(",\"k\":").append(kind).append(",\"s\":[");
        for (int i = 0; i < STACK.size(); i++) { if (i > 0) b.append(','); str(b, STACK.get(i)); }
        b.append("],\"v\":{");
        for (int i = 0; i + 1 < nameValues.length; i += 2) {
            if (i > 0) b.append(',');
            str(b, String.valueOf(nameValues[i]));
            b.append(':');
            try { enc(b, nameValues[i + 1], 0); } catch (RuntimeException e) { b.append("null"); }
        }
        b.append("}}\n");
        out.print(b);
    }

    private static void str(StringBuilder b, String s) {
        b.append('"');
        int limit = Math.min(s.length(), 200);
        for (int i = 0; i < limit; i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        if (s.length() > limit) b.append('…');
        b.append('"');
    }

    private static void num(StringBuilder b, double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) str(b, String.valueOf(d));
        else if (d == Math.rint(d) && Math.abs(d) < 1e15) b.append((long) d);
        else b.append(d);
    }

    private static void enc(StringBuilder b, Object o, int depth) {
        if (o == null) { b.append("null"); return; }
        if (o instanceof String) { str(b, (String) o); return; }
        if (o instanceof Character) { str(b, o.toString()); return; }
        if (o instanceof Boolean) { b.append(o); return; }
        if (o instanceof Double || o instanceof Float) { num(b, ((Number) o).doubleValue()); return; }
        if (o instanceof Number) { b.append(o); return; }
        if (depth > 3) { b.append("\"…\""); return; }
        int max = 200;
        if (o instanceof int[]) { int[] a = (int[]) o; b.append('['); for (int i = 0; i < Math.min(a.length, max); i++) { if (i > 0) b.append(','); b.append(a[i]); } b.append(']'); return; }
        if (o instanceof long[]) { long[] a = (long[]) o; b.append('['); for (int i = 0; i < Math.min(a.length, max); i++) { if (i > 0) b.append(','); b.append(a[i]); } b.append(']'); return; }
        if (o instanceof short[]) { short[] a = (short[]) o; b.append('['); for (int i = 0; i < Math.min(a.length, max); i++) { if (i > 0) b.append(','); b.append(a[i]); } b.append(']'); return; }
        if (o instanceof byte[]) { byte[] a = (byte[]) o; b.append('['); for (int i = 0; i < Math.min(a.length, max); i++) { if (i > 0) b.append(','); b.append(a[i]); } b.append(']'); return; }
        if (o instanceof double[]) { double[] a = (double[]) o; b.append('['); for (int i = 0; i < Math.min(a.length, max); i++) { if (i > 0) b.append(','); num(b, a[i]); } b.append(']'); return; }
        if (o instanceof float[]) { float[] a = (float[]) o; b.append('['); for (int i = 0; i < Math.min(a.length, max); i++) { if (i > 0) b.append(','); num(b, a[i]); } b.append(']'); return; }
        if (o instanceof boolean[]) { boolean[] a = (boolean[]) o; b.append('['); for (int i = 0; i < Math.min(a.length, max); i++) { if (i > 0) b.append(','); b.append(a[i]); } b.append(']'); return; }
        if (o instanceof char[]) { char[] a = (char[]) o; b.append('['); for (int i = 0; i < Math.min(a.length, max); i++) { if (i > 0) b.append(','); str(b, String.valueOf(a[i])); } b.append(']'); return; }
        if (o instanceof Object[]) { Object[] a = (Object[]) o; b.append('['); for (int i = 0; i < Math.min(a.length, max); i++) { if (i > 0) b.append(','); enc(b, a[i], depth + 1); } b.append(']'); return; }
        if (o instanceof java.util.Collection) { b.append('['); int i = 0; for (Object e : (java.util.Collection<?>) o) { if (i >= max) break; if (i++ > 0) b.append(','); enc(b, e, depth + 1); } b.append(']'); return; }
        if (o instanceof java.util.Map) { b.append('{'); int i = 0; for (java.util.Map.Entry<?, ?> e : ((java.util.Map<?, ?>) o).entrySet()) { if (i >= 100) break; if (i++ > 0) b.append(','); str(b, String.valueOf(e.getKey())); b.append(':'); enc(b, e.getValue(), depth + 1); } b.append('}'); return; }
        str(b, String.valueOf(o));
    }
}
