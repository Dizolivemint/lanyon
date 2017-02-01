// const utils = require('./utils')
const Scrolex = require('scrolex')

module.exports = (runtime, cb) => {
  Scrolex.exe('[ -f env.sh ] || (touch env.sh && chmod 600 env.sh && git ignore env.sh)', { cwd: runtime.gitRoot, components: 'lanyon>encrypt' })

  if (!runtime.ghPagesEnv.GHPAGES_URL) {
    return cb(new Error('GHPAGES_URL was not set. Did you source env.sh first?'))
  }

  for (const key in runtime.ghPagesEnv) {
    if (runtime.ghPagesEnv[key]) {
      Scrolex.exe(`travis encrypt --skip-version-check --add env.global ${key}=$${key}`, { cwd: runtime.gitRoot, components: 'lanyon>encrypt' })
    }
  }

  cb(null)
}