# GraphMind trace runtime for R. runner.R sources this file, then the instrumented program.
.gm_state <- new.env()
.gm_state$steps <- 0
.gm_state$max <- suppressWarnings(as.numeric(Sys.getenv("GM_MAX", "5000")))
if (is.na(.gm_state$max)) .gm_state$max <- 5000
.gm_state$counting <- identical(Sys.getenv("GM_COUNT"), "1")
.gm_state$finished <- FALSE
.gm_state$base <- NA
.gm_state$con <- if (nzchar(Sys.getenv("GM_TRACE"))) file(Sys.getenv("GM_TRACE"), open = "w") else NULL

.gm_finish <- function(limited) {
  if (.gm_state$finished || is.null(.gm_state$con)) return(invisible(NULL))
  .gm_state$finished <- TRUE
  writeLines(sprintf('{"done":true,"steps":%d,"limited":%s}', as.integer(.gm_state$steps), if (limited) "true" else "false"), .gm_state$con)
  flush(.gm_state$con)
  invisible(NULL)
}
reg.finalizer(.gm_state, function(e) .gm_finish(FALSE), onexit = TRUE)

.gm_str <- function(s) {
  s <- substr(as.character(s), 1, 200)
  s <- gsub("\\\\", "\\\\\\\\", s)
  s <- gsub('"', '\\\\"', s)
  s <- gsub("[[:cntrl:]]", " ", s)
  paste0('"', s, '"')
}

.gm_atom <- function(x) {
  if (is.na(x)) return("null")
  if (is.logical(x)) return(if (x) "true" else "false")
  if (is.numeric(x)) {
    if (!is.finite(x)) return("null")
    return(format(x, digits = 10, scientific = FALSE, trim = TRUE))
  }
  .gm_str(x)
}

.gm_enc <- function(x, depth = 0) {
  if (is.null(x)) return("null")
  if (is.function(x) || is.environment(x)) return(NULL)
  if (depth > 3) return('"..."')
  if (is.matrix(x)) {
    rows <- min(nrow(x), 50)
    parts <- vapply(seq_len(rows), function(r) .gm_enc(as.vector(x[r, seq_len(min(ncol(x), 50))]), depth + 1), "")
    return(paste0("[", paste(parts, collapse = ","), "]"))
  }
  if (is.list(x)) {
    items <- head(x, 100)
    parts <- lapply(items, .gm_enc, depth = depth + 1)
    keep <- !vapply(parts, is.null, TRUE)
    parts <- unlist(parts[keep])
    nm <- names(items)[keep]
    if (!is.null(nm) && all(nzchar(nm))) return(paste0("{", paste(paste0(vapply(nm, .gm_str, ""), ":", parts), collapse = ","), "}"))
    return(paste0("[", paste(parts, collapse = ","), "]"))
  }
  if (is.atomic(x)) {
    if (is.factor(x)) x <- as.character(x)
    if (length(x) == 1 && is.null(dim(x))) return(.gm_atom(x))
    parts <- vapply(head(as.vector(x), 200), .gm_atom, "")
    return(paste0("[", paste(parts, collapse = ","), "]"))
  }
  NULL
}

.gm <- function(line, kind) {
  .gm_state$steps <- .gm_state$steps + 1
  if (.gm_state$steps > .gm_state$max) {
    .gm_finish(TRUE)
    quit(save = "no", status = 0)
  }
  if (.gm_state$counting || is.null(.gm_state$con)) return(invisible(NULL))
  env <- parent.frame()
  depth <- sys.nframe() - 1
  if (is.na(.gm_state$base)) .gm_state$base <- depth
  calls <- if (depth > .gm_state$base) sys.calls()[(.gm_state$base + 1):depth] else list()
  names <- vapply(calls, function(cl) { fn <- cl[[1]]; if (is.name(fn)) as.character(fn) else "<anonymous>" }, "")
  # Lazy evaluation puts callers like print() on the stack; keep the user's own functions.
  names <- names[vapply(names, function(n) n == "<anonymous>" || exists(n, envir = globalenv(), inherits = FALSE), TRUE)]
  stack <- c("<main>", names)
  vars <- character(0)
  for (name in ls(env)) {
    if (startsWith(name, ".gm")) next
    value <- tryCatch(get(name, envir = env), error = function(e) NULL)
    encoded <- tryCatch(.gm_enc(value), error = function(e) NULL)
    if (!is.null(encoded)) vars <- c(vars, paste0(.gm_str(name), ":", encoded))
  }
  writeLines(paste0('{"l":', line, ',"k":', kind, ',"s":[', paste(vapply(stack, .gm_str, ""), collapse = ","), '],"v":{', paste(vars, collapse = ","), '}}'), .gm_state$con)
  invisible(NULL)
}

.gm_n <- function() as.numeric(Sys.getenv("GM_N", "0"))
.gm_data <- function() {
  i <- seq_len(.gm_n()) - 1
  if (identical(Sys.getenv("GM_SORTED"), "1")) i * 3 + 1 else (i * 7919 + 13) %% 1000
}
