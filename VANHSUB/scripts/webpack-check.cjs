// Nextron can log a webpack error while exiting zero. Make the build result truthful.
const id = require.resolve('webpack', { paths: [process.cwd()] });
const webpack = require(id);
require.cache[id].exports = new Proxy(webpack, {
  apply(target, receiver, args) {
    const compiler = Reflect.apply(target, receiver, args);
    const run = compiler.run.bind(compiler);
    compiler.run = callback => run((error, stats) => {
      if (error || stats?.hasErrors()) process.exitCode = 1;
      callback?.(error, stats);
    });
    return compiler;
  },
});
