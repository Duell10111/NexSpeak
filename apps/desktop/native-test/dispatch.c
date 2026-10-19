// Exercise the actual patched dispatch_proc, replacing only OS hooks with deterministic input.
#include <stdlib.h>
#include <node_api.h>
#include <uiohook.h>

static uint32_t allocations = 0;
static uint32_t wakeups = 0;

static void* counted_malloc(size_t size) {
  allocations++;
  return malloc(size);
}

static napi_status counted_call(napi_threadsafe_function fn, void* data, napi_threadsafe_function_call_mode mode) {
  wakeups++;
  return napi_call_threadsafe_function(fn, data, mode);
}

#undef NAPI_MODULE_INIT
#define NAPI_MODULE_INIT() static napi_value upstream_init(napi_env env, napi_value exports)
#define malloc counted_malloc
#define napi_call_threadsafe_function counted_call
#include "addon.c"
#undef malloc
#undef napi_call_threadsafe_function
#include "napi_helpers.c"

int uiohook_worker_start(dispatcher_t dispatcher) { return UIOHOOK_SUCCESS; }
int uiohook_worker_stop(void) { return UIOHOOK_SUCCESS; }
void hook_post_event(uiohook_event* const event) { dispatch_proc(event); }

static napi_value Dispatch(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  uint32_t type, code, count;
  NAPI_THROW_IF_FAILED(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL), NULL);
  NAPI_THROW_IF_FAILED(env, napi_get_value_uint32(env, argv[0], &type), NULL);
  NAPI_THROW_IF_FAILED(env, napi_get_value_uint32(env, argv[1], &code), NULL);
  NAPI_THROW_IF_FAILED(env, napi_get_value_uint32(env, argv[2], &count), NULL);
  uiohook_event event = {0};
  event.type = (event_type)type;
  if (type == EVENT_KEY_PRESSED || type == EVENT_KEY_RELEASED) event.data.keyboard.keycode = (uint16_t)code;
  else event.data.mouse.button = (uint16_t)code;
  for (uint32_t i = 0; i < count; i++) dispatch_proc(&event);
  return NULL;
}

static napi_value Counters(napi_env env, napi_callback_info info) {
  napi_value result, value;
  napi_create_array_with_length(env, 2, &result);
  napi_create_uint32(env, allocations, &value);
  napi_set_element(env, result, 0, value);
  napi_create_uint32(env, wakeups, &value);
  napi_set_element(env, result, 1, value);
  return result;
}

// Register our entry point; the upstream one above is called without registering a second addon.
NAPI_MODULE_EXPORT napi_value NAPI_MODULE_INITIALIZER(napi_env env, napi_value exports) {
  upstream_init(env, exports);
  napi_value fn;
  napi_create_function(env, NULL, 0, Dispatch, NULL, &fn);
  napi_set_named_property(env, exports, "dispatch", fn);
  napi_create_function(env, NULL, 0, Counters, NULL, &fn);
  napi_set_named_property(env, exports, "counters", fn);
  return exports;
}
