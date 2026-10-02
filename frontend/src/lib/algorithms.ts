// Reference algorithm library shown in the Studio's algorithm header.
// Snippets are Python (every language traces, but one reference language keeps
// the library compact); each snippet is self-contained and prints its result.

export type AlgorithmCategory =
  | "Sorting"
  | "Searching"
  | "Graphs"
  | "Dynamic Programming"
  | "Recursion"
  | "Data Structures";

export interface AlgorithmReference {
  id: string;
  name: string;
  category: AlgorithmCategory;
  time: string;
  space: string;
  summary: string;
  code: string;
}

export const ALGORITHM_CATEGORIES: AlgorithmCategory[] = [
  "Sorting",
  "Searching",
  "Graphs",
  "Dynamic Programming",
  "Recursion",
  "Data Structures",
];

export const ALGORITHMS: AlgorithmReference[] = [
  {
    id: "bubble-sort",
    name: "Bubble Sort",
    category: "Sorting",
    time: "O(N²)",
    space: "O(1)",
    summary: "Repeatedly swaps adjacent out-of-order pairs; the largest value bubbles to the end each pass.",
    code: `def bubble_sort(arr):
    n = len(arr)
    for i in range(n):
        for j in range(n - i - 1):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
    return arr

numbers = [5, 2, 8, 1, 9, 3]
print("Sorted:", bubble_sort(numbers))
`,
  },
  {
    id: "selection-sort",
    name: "Selection Sort",
    category: "Sorting",
    time: "O(N²)",
    space: "O(1)",
    summary: "Finds the minimum of the unsorted part and moves it to the front, one position at a time.",
    code: `def selection_sort(arr):
    n = len(arr)
    for i in range(n):
        smallest = i
        for j in range(i + 1, n):
            if arr[j] < arr[smallest]:
                smallest = j
        arr[i], arr[smallest] = arr[smallest], arr[i]
    return arr

numbers = [64, 25, 12, 22, 11]
print("Sorted:", selection_sort(numbers))
`,
  },
  {
    id: "insertion-sort",
    name: "Insertion Sort",
    category: "Sorting",
    time: "O(N²)",
    space: "O(1)",
    summary: "Builds the sorted list one item at a time by sliding each value left into place.",
    code: `def insertion_sort(arr):
    for i in range(1, len(arr)):
        key = arr[i]
        j = i - 1
        while j >= 0 and arr[j] > key:
            arr[j + 1] = arr[j]
            j -= 1
        arr[j + 1] = key
    return arr

numbers = [12, 11, 13, 5, 6]
print("Sorted:", insertion_sort(numbers))
`,
  },
  {
    id: "merge-sort",
    name: "Merge Sort",
    category: "Sorting",
    time: "O(N log N)",
    space: "O(N)",
    summary: "Divides the list in half, sorts each half recursively, then merges the two sorted halves.",
    code: `def merge_sort(arr):
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    left = merge_sort(arr[:mid])
    right = merge_sort(arr[mid:])
    merged = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            merged.append(left[i])
            i += 1
        else:
            merged.append(right[j])
            j += 1
    merged.extend(left[i:])
    merged.extend(right[j:])
    return merged

numbers = [38, 27, 43, 3, 9, 82, 10]
print("Sorted:", merge_sort(numbers))
`,
  },
  {
    id: "quick-sort",
    name: "Quick Sort",
    category: "Sorting",
    time: "O(N log N) avg",
    space: "O(log N)",
    summary: "Picks a pivot, partitions smaller values to its left and larger to its right, then recurses.",
    code: `def partition(arr, low, high):
    pivot = arr[high]
    i = low - 1
    for j in range(low, high):
        if arr[j] <= pivot:
            i += 1
            arr[i], arr[j] = arr[j], arr[i]
    arr[i + 1], arr[high] = arr[high], arr[i + 1]
    return i + 1

def quick_sort(arr, low, high):
    if low < high:
        p = partition(arr, low, high)
        quick_sort(arr, low, p - 1)
        quick_sort(arr, p + 1, high)
    return arr

numbers = [10, 7, 8, 9, 1, 5]
print("Sorted:", quick_sort(numbers, 0, len(numbers) - 1))
`,
  },
  {
    id: "linear-search",
    name: "Linear Search",
    category: "Searching",
    time: "O(N)",
    space: "O(1)",
    summary: "Checks every element in order until the target is found.",
    code: `def linear_search(arr, target):
    for i in range(len(arr)):
        if arr[i] == target:
            return i
    return -1

numbers = [4, 2, 7, 1, 9, 5]
print("Index of 9:", linear_search(numbers, 9))
`,
  },
  {
    id: "binary-search",
    name: "Binary Search",
    category: "Searching",
    time: "O(log N)",
    space: "O(1)",
    summary: "Halves a sorted search range each step by comparing the target with the middle element.",
    code: `def binary_search(arr, target):
    low, high = 0, len(arr) - 1
    while low <= high:
        mid = (low + high) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1

numbers = [1, 3, 5, 7, 9, 11, 13, 15]
print("Index of 11:", binary_search(numbers, 11))
`,
  },
  {
    id: "bfs",
    name: "Breadth-First Search",
    category: "Graphs",
    time: "O(V + E)",
    space: "O(V)",
    summary: "Explores a graph level by level using a queue; finds shortest paths in unweighted graphs.",
    code: `from collections import deque

def bfs(graph, start):
    visited = [start]
    queue = deque([start])
    while queue:
        node = queue.popleft()
        for neighbor in graph[node]:
            if neighbor not in visited:
                visited.append(neighbor)
                queue.append(neighbor)
    return visited

graph = {
    "A": ["B", "C"],
    "B": ["D", "E"],
    "C": ["F"],
    "D": [], "E": ["F"], "F": [],
}
print("BFS order:", bfs(graph, "A"))
`,
  },
  {
    id: "dfs",
    name: "Depth-First Search",
    category: "Graphs",
    time: "O(V + E)",
    space: "O(V)",
    summary: "Follows one branch as deep as possible before backtracking; uses recursion or a stack.",
    code: `def dfs(graph, node, visited):
    visited.append(node)
    for neighbor in graph[node]:
        if neighbor not in visited:
            dfs(graph, neighbor, visited)
    return visited

graph = {
    "A": ["B", "C"],
    "B": ["D", "E"],
    "C": ["F"],
    "D": [], "E": ["F"], "F": [],
}
print("DFS order:", dfs(graph, "A", []))
`,
  },
  {
    id: "dijkstra",
    name: "Dijkstra's Shortest Path",
    category: "Graphs",
    time: "O((V + E) log V)",
    space: "O(V)",
    summary: "Greedily settles the closest unvisited node using a priority queue to find shortest weighted paths.",
    code: `import heapq

def dijkstra(graph, start):
    dist = {node: float("inf") for node in graph}
    dist[start] = 0
    heap = [(0, start)]
    while heap:
        d, node = heapq.heappop(heap)
        if d > dist[node]:
            continue
        for neighbor, weight in graph[node]:
            if d + weight < dist[neighbor]:
                dist[neighbor] = d + weight
                heapq.heappush(heap, (dist[neighbor], neighbor))
    return dist

graph = {
    "A": [("B", 4), ("C", 1)],
    "B": [("D", 1)],
    "C": [("B", 2), ("D", 5)],
    "D": [],
}
print("Distances:", dijkstra(graph, "A"))
`,
  },
  {
    id: "fibonacci-dp",
    name: "Fibonacci (Tabulation)",
    category: "Dynamic Programming",
    time: "O(N)",
    space: "O(N)",
    summary: "Builds answers bottom-up in a table so each subproblem is solved exactly once.",
    code: `def fibonacci(n):
    table = [0] * (n + 1)
    if n > 0:
        table[1] = 1
    for i in range(2, n + 1):
        table[i] = table[i - 1] + table[i - 2]
    return table[n]

print("fib(10) =", fibonacci(10))
`,
  },
  {
    id: "knapsack",
    name: "0/1 Knapsack",
    category: "Dynamic Programming",
    time: "O(N · W)",
    space: "O(W)",
    summary: "Chooses items to maximise value without exceeding capacity, reusing a 1-D table of best values.",
    code: `def knapsack(weights, values, capacity):
    best = [0] * (capacity + 1)
    for i in range(len(weights)):
        for w in range(capacity, weights[i] - 1, -1):
            best[w] = max(best[w], best[w - weights[i]] + values[i])
    return best[capacity]

weights = [1, 3, 4, 5]
values = [1, 4, 5, 7]
print("Best value:", knapsack(weights, values, 7))
`,
  },
  {
    id: "factorial",
    name: "Factorial",
    category: "Recursion",
    time: "O(N)",
    space: "O(N)",
    summary: "The classic recursion: a base case plus a call on a smaller input.",
    code: `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print("5! =", factorial(5))
`,
  },
  {
    id: "hanoi",
    name: "Tower of Hanoi",
    category: "Recursion",
    time: "O(2^N)",
    space: "O(N)",
    summary: "Moves N disks by recursively moving N−1 disks out of the way twice.",
    code: `moves = []

def hanoi(n, source, target, spare):
    if n == 0:
        return
    hanoi(n - 1, source, spare, target)
    moves.append((source, target))
    hanoi(n - 1, spare, target, source)

hanoi(3, "A", "C", "B")
print(len(moves), "moves:", moves)
`,
  },
  {
    id: "balanced-brackets",
    name: "Stack: Balanced Brackets",
    category: "Data Structures",
    time: "O(N)",
    space: "O(N)",
    summary: "Pushes opening brackets and pops on each closing bracket to verify they match.",
    code: `def is_balanced(text):
    pairs = {")": "(", "]": "[", "}": "{"}
    stack = []
    for ch in text:
        if ch in "([{":
            stack.append(ch)
        elif ch in pairs:
            if not stack or stack.pop() != pairs[ch]:
                return False
    return len(stack) == 0

print(is_balanced("{[()()]}"), is_balanced("([)]"))
`,
  },
  {
    id: "two-pointers",
    name: "Two Pointers: Pair Sum",
    category: "Data Structures",
    time: "O(N)",
    space: "O(1)",
    summary: "Walks pointers inward from both ends of a sorted array to find a pair with a given sum.",
    code: `def pair_sum(arr, target):
    left, right = 0, len(arr) - 1
    while left < right:
        total = arr[left] + arr[right]
        if total == target:
            return (arr[left], arr[right])
        if total < target:
            left += 1
        else:
            right -= 1
    return None

numbers = [1, 2, 4, 7, 11, 15]
print("Pair:", pair_sum(numbers, 15))
`,
  },
];
