{
  'targets': [{
    'target_name': 'input_hook_test',
    'sources': ['dispatch.c'],
    'include_dirs': [
      '<!(node -p "require.resolve(\'uiohook-napi/package.json\').replace(/package.json$/, \'src/lib\')")',
      '<!(node -p "require.resolve(\'uiohook-napi/package.json\').replace(/package.json$/, \'libuiohook/include\')")',
    ],
  }],
}
