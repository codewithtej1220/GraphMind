package main

// GraphMind trace runtime, compiled alongside the instrumented program.

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"strconv"
)

var (
	__gmStack    = []string{}
	__gmSteps    int64
	__gmMax      int64 = 5000
	__gmCounting bool
	__gmFile     *os.File
	__gmFinished bool
)

func init() {
	__gmCounting = os.Getenv("GM_COUNT") == "1"
	if v, err := strconv.ParseInt(os.Getenv("GM_MAX"), 10, 64); err == nil {
		__gmMax = v
	}
	if path := os.Getenv("GM_TRACE"); path != "" {
		if f, err := os.Create(path); err == nil {
			__gmFile = f
		}
	}
}

func __gmFinish(limited bool) {
	if __gmFinished || __gmFile == nil {
		return
	}
	__gmFinished = true
	line, _ := json.Marshal(map[string]any{"done": true, "steps": __gmSteps, "limited": limited})
	__gmFile.Write(append(line, '\n'))
}

func __gmE(name string) { __gmStack = append(__gmStack, name) }
func __gmX() {
	if len(__gmStack) > 0 {
		__gmStack = __gmStack[:len(__gmStack)-1]
	}
}

func __gmN() int {
	n, _ := strconv.Atoi(os.Getenv("GM_N"))
	return n
}

func __gmValue(i int) int {
	if os.Getenv("GM_SORTED") == "1" {
		return i*3 + 1
	}
	return (i*7919 + 13) % 1000
}

func __gmDataInt() []int {
	a := make([]int, __gmN())
	for i := range a {
		a[i] = __gmValue(i)
	}
	return a
}

func __gmDataFloat() []float64 {
	a := make([]float64, __gmN())
	for i := range a {
		a[i] = float64(__gmValue(i))
	}
	return a
}

func __gmEncode(v reflect.Value, depth int) any {
	if !v.IsValid() {
		return nil
	}
	switch v.Kind() {
	case reflect.Bool:
		return v.Bool()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return v.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return v.Uint()
	case reflect.Float32, reflect.Float64:
		f := v.Float()
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return fmt.Sprint(f)
		}
		return f
	case reflect.String:
		s := v.String()
		if len(s) > 200 {
			s = s[:200] + "…"
		}
		return s
	case reflect.Slice, reflect.Array:
		if depth > 3 {
			return "…"
		}
		n := v.Len()
		if n > 200 {
			n = 200
		}
		out := make([]any, n)
		for i := 0; i < n; i++ {
			out[i] = __gmEncode(v.Index(i), depth+1)
		}
		return out
	case reflect.Map:
		if depth > 3 {
			return "…"
		}
		out := map[string]any{}
		iter := v.MapRange()
		for count := 0; iter.Next() && count < 100; count++ {
			out[fmt.Sprint(iter.Key().Interface())] = __gmEncode(iter.Value(), depth+1)
		}
		return out
	case reflect.Pointer, reflect.Interface:
		if v.IsNil() {
			return nil
		}
		return __gmEncode(v.Elem(), depth+1)
	case reflect.Func, reflect.Chan, reflect.UnsafePointer:
		return nil
	default:
		s := fmt.Sprintf("%+v", v.Interface())
		if len(s) > 200 {
			s = s[:200] + "…"
		}
		return s
	}
}

func __gm(line int, kind int, nameValues ...any) {
	__gmSteps++
	if __gmSteps > __gmMax {
		__gmFinish(true)
		os.Exit(0)
	}
	if __gmCounting || __gmFile == nil {
		return
	}
	vars := map[string]any{}
	for i := 0; i+1 < len(nameValues); i += 2 {
		value := reflect.ValueOf(nameValues[i+1])
		if value.IsValid() && (value.Kind() == reflect.Func || value.Kind() == reflect.Chan) {
			continue
		}
		vars[fmt.Sprint(nameValues[i])] = __gmEncode(value, 0)
	}
	line2, err := json.Marshal(map[string]any{"l": line, "k": kind, "s": __gmStack, "v": vars})
	if err != nil {
		line2, _ = json.Marshal(map[string]any{"l": line, "k": kind, "s": __gmStack, "v": map[string]any{}})
	}
	__gmFile.Write(append(line2, '\n'))
}
