const _                       = require('lodash')
const path                    = require('path')
const utils                   = require('./utils')
const shell                   = require('shelljs')
const fs                      = require('fs')
const ExtractTextPlugin       = require('extract-text-webpack-plugin')
const webpack                 = require('webpack')
const webpackDevMiddleware    = require('webpack-dev-middleware')
const webpackHotMiddleware    = require('webpack-hot-middleware')
// const BowerWebpackPlugin      = require('bower-webpack-plugin')
const SvgStoreWebpackPlugin   = require('webpack-svgstore-plugin')
const OptimizeCssAssetsPlugin = require('optimize-css-assets-webpack-plugin')
const Visualizer              = require('webpack-visualizer-plugin')
const yaml                    = require('js-yaml')
const AssetsPlugin            = require('assets-webpack-plugin')
const WebpackMd5Hash          = require('webpack-md5-hash')
const scrolex                 = require('scrolex').persistOpts({
  announce             : true,
  addCommandAsComponent: true,
  components           : `lanyon>config`,
})

if (require.main === module) {
  scrolex.failure(`Please only used this module via require, or: src/cli.js ${process.argv[1]}`)
  process.exit(1)
}

let runtime = {}

runtime.lanyonDir         = path.join(__dirname, '..')
runtime.lanyonEnv         = process.env.LANYON_ENV || 'development'
runtime.lanyonPackageFile = path.join(runtime.lanyonDir, 'package.json')
const lanyonPackage       = require(runtime.lanyonPackageFile)
runtime.lanyonVersion     = lanyonPackage.version

runtime.profile    = process.env.LANYON_PROFILE === '1' || !('LANYON_PROFILE' in process.env)
runtime.trace      = process.env.LANYON_TRACE === '1'
runtime.publicPath = '/assets/build/'

runtime.rubyProvidersOnly = (process.env.LANYON_ONLY || '')
runtime.rubyProvidersSkip = (process.env.LANYON_SKIP || '').split(/\s+/)

runtime.lanyonUpdateGemLockfile = process.env.LANYON_UPDATE_GEM_LOCKFILE === '1'
runtime.lanyonReset             = process.env.LANYON_RESET               === '1'
runtime.onTravis                = process.env.TRAVIS                     === 'true'
runtime.ghPagesEnv              = {
  GHPAGES_URL     : process.env.GHPAGES_URL,
  GHPAGES_BOTNAME : process.env.GHPAGES_BOTNAME,
  GHPAGES_BOTEMAIL: process.env.GHPAGES_BOTEMAIL,
}
runtime.isDev     = runtime.lanyonEnv === 'development'
runtime.attachHMR = runtime.isDev && process.argv[1].indexOf('browser-sync') !== -1 && process.argv[2] === 'start'

runtime.projectDir = process.env.LANYON_PROJECT || process.env.PWD || process.cwd() // <-- symlinked npm will mess up process.cwd() and point to ~/code/lanyon

runtime.npmRoot = utils.upwardDirContaining('package.json', runtime.projectDir, 'lanyon')
if (!runtime.npmRoot) {
  scrolex.failure(`Unable to determine non-lanyon npmRoot, falling back to ${runtime.projectDir}`)
  runtime.npmRoot = runtime.projectDir
}
runtime.gitRoot = utils.upwardDirContaining('.git', runtime.npmRoot)

runtime.projectPackageFile = path.join(runtime.npmRoot, 'package.json')
try {
  var projectPackage = require(runtime.projectPackageFile)
} catch (e) {
  projectPackage = {}
}

runtime.gems = _.defaults(_.get(projectPackage, 'lanyon.gems') || {}, _.get(lanyonPackage, 'lanyon.gems'))
runtime      = _.defaults(projectPackage.lanyon || {}, lanyonPackage.lanyon, runtime)

try {
  runtime.projectDir = fs.realpathSync(runtime.projectDir)
} catch (e) {
  runtime.projectDir = fs.realpathSync(`${runtime.gitRoot}/${runtime.projectDir}`)
}

runtime.cacheDir        = path.join(runtime.projectDir, '.lanyon')
runtime.binDir          = path.join(runtime.cacheDir, 'bin')
runtime.recordsPath     = path.join(runtime.cacheDir, 'records.json')
runtime.assetsSourceDir = path.join(runtime.projectDir, 'assets')
runtime.assetsBuildDir  = path.join(runtime.assetsSourceDir, 'build')
runtime.contentBuildDir = path.join(runtime.projectDir, '_site')
runtime.contentScandir  = path.join(runtime.projectDir, runtime.contentScandir || '.')
runtime.contentIgnore   = runtime.contentIgnore || []

// Load project's jekyll _config.yml
runtime.jekyllConfig   = {}
const jekyllConfigPath = path.join(runtime.projectDir, '_config.yml')
try {
  const buf            = fs.readFileSync(jekyllConfigPath)
  runtime.jekyllConfig = yaml.safeLoad(buf)
} catch (e) {
  scrolex.failure(`Unable to load ${jekyllConfigPath}`)
}

runtime.themeDir = false
if (runtime.jekyllConfig.theme) {
  const cmd = `${path.join(runtime.binDir, 'bundler')} show ${runtime.jekyllConfig.theme}`
  const z   = shell.exec(cmd).stdout
  if (!z) {
    scrolex.failure(`Unable find defined them "${runtime.jekyllConfig.theme}" via cmd: "${cmd}"`)
  } else {
    runtime.themeDir = z
  }
}

// Determine rubyProvider sources to traverse
const allApps = [ 'system', 'docker', 'rbenv', 'rvm', 'ruby-shim' ]
if (runtime.rubyProvidersOnly === 'auto-all') {
  runtime.rubyProvidersOnly = ''
}

if (runtime.rubyProvidersOnly) {
  runtime.rubyProvidersSkip = []
  allApps.forEach(app => {
    if (app !== runtime.rubyProvidersOnly) {
      runtime.rubyProvidersSkip.push(app)
    }
  })
}

function getFilename (extension, isChunk, isContent) {
  let filename = `[name].${extension}`

  if (!runtime.isDev) {
    filename = `[name].[chunkhash].${extension}`
    if (isContent) {
      filename = `[name].[contenthash].${extension}`
    }
  }

  if (isChunk) {
    filename = `[name].[chunkhash].[id].chunk.${extension}`
  }

  return filename
}

const cfg = {
  webpack: {
    entry: (function dynamicEntries () {
      var entries = {}
      runtime.entries.forEach(entry => {
        entries[entry] = [ path.join(runtime.assetsSourceDir, `${entry}.js`) ]

        if (entry === 'app' && runtime.isDev) {
          entries[entry].unshift('webpack-hot-middleware/client')
        }
      })

      if (runtime.common) {
        // e.g.: [ "jquery" ]
        // https://webpack.github.io/docs/code-splitting.html#split-app-and-vendor-code
        entries.common = runtime.common
      }

      return entries
    }()),
    node: {
      fs    : 'empty',
      module: 'empty',
    },
    target: 'web',
    output: {
      publicPath   : runtime.publicPath,
      path         : runtime.assetsBuildDir,
      filename     : getFilename('js'),
      chunkFilename: getFilename('js', true),
      // cssFilename  : getFilename('css'),
    },
    // devtool: 'eval-cheap-source-map',
    devtool: 'inline-eval-cheap-source-map',
    // devtool: 'source-map',
    bail   : false, // <-- We use our own ReportErrors plugin as with bail errors details are lost. e.g.: `Error at NormalModule.onModuleBuildFailed`
    module : {
      rules: (function dynamicRules () {
        let rules = [
          {
            test: /\.woff(\?v=\d+\.\d+\.\d+)?$/,
            use : [
              {
                loader : 'url-loader',
                options: {
                  limit   : 10000,
                  mimetype: 'application/font-woff',
                },
              },
            ],
          }, {
            test: /\.woff2(\?v=\d+\.\d+\.\d+)?$/,
            use : [
              {
                loader : 'url-loader',
                options: {
                  limit   : 10000,
                  mimetype: 'application/font-woff',
                },
              },
            ],
          }, {
            test: /\.ttf(\?v=\d+\.\d+\.\d+)?$/,
            use : [
              {
                loader : 'url-loader',
                options: {
                  limit   : 10000,
                  mimetype: 'application/octet-stream',
                },
              },
            ],
          }, {
            test: /\.eot(\?v=\d+\.\d+\.\d+)?$/,
            use : [
              {
                loader: 'file-loader',
              },
            ],
          }, {
            test: /\.cur(\?v=\d+\.\d+\.\d+)?$/,
            use : [
              {
                loader: 'file-loader',
              },
            ],
          }, {
            test: /\.svg(\?v=\d+\.\d+\.\d+)?$/,
            use : [
              {
                loader : 'url-loader',
                options: {
                  limit   : 10000,
                  mimetype: 'image/svg+xml',
                },
              },
            ],
          },
          {
            test: /\.coffee$/,
            use : [
              {
                loader: 'coffee-loader',
              },
            ],
          },
          {
            test: /\.(png|gif|jpe?g)$/,
            use : [
              {
                loader : 'url-loader',
                options: {
                  limit   : 8096,
                  mimetype: 'application/octet-stream',
                },
              },
            ],
          },
          {
            // https://github.com/webpack/webpack/issues/512
            test: /[\\/](bower_components)[\\/]modernizr[\\/]modernizr\.js$/,
            use : [
              // loader: 'imports?this=>window!exports?window.Modernizr',
              {
                loader : 'imports-loader',
                options: {
                  this: '>window',
                },
              },
              {
                loader : 'exports-loader',
                options: {
                  'window.Modernizr': true,
                },
              },
            ],
          },
          {
            test: /[\\/](bower_components)[\\/]svgeezy[\\/]svgeezy\.js$/,
            use : [
              // loader: 'imports?this=>window!exports?svgeezy',
              {
                loader : 'imports-loader',
                options: {
                  this: '>window',
                },
              },
              {
                loader : 'exports-loader',
                options: {
                  'svgeezy': true,
                },
              },
            ],
          },
          {
            // https://www.techchorus.net/blog/using-sass-version-of-bootstrap-with-webpack/
            test: /[\\/](bower_components)[\\/]bootstrap-sass[\\/]assets[\\/]javascripts[\\/]/,
            use : [
              // loader: 'imports?jQuery=jquery,$=jquery,this=>window',
              {
                loader : 'imports-loader',
                options: {
                  jQuery: 'jquery',
                  $     : 'jquery',
                  this  : '>window',
                },
              },
            ],
          },
          {
            test: /[\\/]jquery\..*\.js$/,
            use : [
              // loader: 'imports?jQuery=jquery,$=jquery,this=>window',
              {
                loader : 'imports-loader',
                options: {
                  jQuery: 'jquery',
                  $     : 'jquery',
                  this  : '>window',
                },
              },
            ],
          },
        ]

        if (runtime.isDev) {
          rules.push({
            test: /\.css$/,
            use : [
              {
                loader: 'style-loader',
              },
              {
                loader : 'css-loader',
                options: {
                  // sourceMap: true,
                },
              },
              {
                loader: 'resolve-url-loader',
              },
            ],
          })
          rules.push({
            test: /\.scss$/,
            use : [
              {
                loader: 'style-loader',
              },
              {
                loader : 'css-loader',
                options: {
                  // sourceMap: true,
                },
              },
              {
                loader: 'resolve-url-loader',
              },
              {
                loader : 'sass-loader',
                options: {
                  // sourceMap: true,
                },
              },
            ],
          })
          rules.push({
            test: /\.less$/,
            use : [
              {
                loader: 'style-loader',
              },
              {
                loader : 'css-loader',
                options: {
                  // sourceMap: true,
                },
              },
              {
                loader: 'resolve-url-loader',
              },
              {
                loader : 'less-loader',
                options: {
                  // sourceMap: true,
                },
              },
            ],
          })
        } else {
          rules.push({
            test: /\.css$/,
            use : ExtractTextPlugin.extract({
              fallback: 'style-loader',
              use     : [
                {
                  loader : 'css-loader',
                  options: {
                    sourceMap: true,
                  },
                },
                {
                  loader : 'resolve-url-loader',
                  options: {
                    sourceMap: true,
                  },
                },
              ],
            }),
          })
          rules.push({
            test: /\.scss$/,
            use : ExtractTextPlugin.extract({
              fallback: 'style-loader',
              use     : [
                {
                  loader : 'css-loader',
                  options: {
                    sourceMap: true,
                  },
                },
                {
                  loader : 'resolve-url-loader',
                  options: {
                    sourceMap: true,
                  },
                },
                {
                  loader : 'sass-loader',
                  options: {
                    sourceMap: true,
                  },
                },
              ],
            }),
          })
          rules.push({
            test: /\.less$/,
            use : ExtractTextPlugin.extract({
              fallback: 'style-loader',
              use     : [
                {
                  loader : 'css-loader',
                  options: {
                    sourceMap: true,
                  },
                },
                {
                  loader : 'resolve-url-loader',
                  options: {
                    sourceMap: true,
                  },
                },
                {
                  loader : 'less-loader',
                  options: {
                    sourceMap: true,
                  },
                },
              ],
            }),
          })
        }

        rules.push({
          test   : /\.(js|jsx)$/,
          include: [
            `${runtime.assetsSourceDir}`,
          ],
          exclude: [
            `${runtime.assetsSourceDir}/bower_components`,
            /[\\/](node_modules|bower_components|js-untouched)[\\/]/,
          ],
          loader : 'babel-loader',
          options: {
            babelrc: false,
            presets: [
              require.resolve('babel-preset-es2015'),
              require.resolve('babel-preset-react'),
              require.resolve('babel-preset-stage-0'),
            ],
            // sourceRoot    : `${runtime.projectDir}`,
            cacheDirectory: `${runtime.cacheDir}/babelCache`,
          },
        })
        return rules
      }()),
    },
    plugins: (function dynamicPlugins () {
      let plugins = [
        // new BowerWebpackPlugin(),
        new webpack.ProvidePlugin({
          _     : 'lodash',
          $     : 'jquery',
          jQuery: 'jquery',
        }),
        new SvgStoreWebpackPlugin({
          svgoOptions: {
            plugins: [
             { removeTitle: true },
            ],
          },
          prefix: 'icon-',
        }),
        // Until loaders are updated one can use the LoaderOptionsPlugin to switch loaders into debug mode:
        new webpack.LoaderOptionsPlugin({
          debug  : runtime.isDev,
          context: runtime.projectDir,
        }),
        new AssetsPlugin({
          filename: 'jekyll.lanyon_assets.yml',
          path    : runtime.cacheDir,
          processOutput (assets) {
            scrolex.stick(`Writing asset manifest to: "${runtime.cacheDir}/jekyll.lanyon_assets.yml"`)
            try {
              return yaml.safeDump({lanyon_assets: assets})
            } catch (e) {
              console.log(assets)
              throw new Error(`Unable to encode above config to YAML. ${e.message}`)
            }
          },
        }),
        new WebpackMd5Hash(),
      ]

      if (runtime.isDev) {
        plugins.push(new webpack.HotModuleReplacementPlugin())
      } else {
        plugins.push(new ExtractTextPlugin({
          filename : getFilename('css'),
          allChunks: true,
        }))
        plugins.push(new webpack.optimize.UglifyJsPlugin({
          compress: {
            warnings: true,
          },
          mangle   : true,
          sourceMap: runtime.isDev,
          exclude  : /[\\/](node_modules|bower_components|js-untouched)[\\/]/,
        }))

        // plugins.push(new webpack.NoErrorsPlugin())
        plugins.push(new OptimizeCssAssetsPlugin())
        plugins.push(new webpack.optimize.LimitChunkCountPlugin({maxChunks: 15}))
        plugins.push(new webpack.optimize.MinChunkSizePlugin({minChunkSize: 10000}))
        plugins.push(function ReportErrors () {
          this.plugin('done', ({compilation}) => {
            for (const asset in compilation.assets) {
              scrolex.stick(`Wrote ${runtime.assetsBuildDir}/${asset}`)
            }
            if (compilation.errors && compilation.errors.length) {
              scrolex.failure(compilation.errors)
              if (!runtime.isDev) {
                process.exit(1)
              }
            }
          })
        })
      }

      if (runtime.common) {
        plugins.push(new webpack.optimize.CommonsChunkPlugin({
          name    : 'common',
          filename: 'common.js', //getFilename('js'),
        }))
      }

      if (!runtime.isDev && runtime.statistics) {
        // @todo: Once Vizualizer supports multiple entries, add support for that here
        // https://github.com/chrisbateman/webpack-visualizer/issues/5
        // Currently it just shows stats for all entries in one graph
        plugins.push(new Visualizer({
          filename: runtime.statistics,
        }))
      }

      return plugins
    }()),
    resolveLoader: {
      modules: [
        path.join(runtime.lanyonDir, 'node_modules'),
        path.join(runtime.projectDir, 'node_modules'),
      ],
    },
    recordsPath: runtime.recordsPath,
    resolve    : {
      modules: [
        `${path.resolve(runtime.assetsSourceDir)}`,
        `${path.resolve(runtime.assetsSourceDir)}/bower_components`,
        `${path.resolve(runtime.projectDir)}/node_modules`,
        `${path.resolve(runtime.lanyonDir)}/node_modules`,
      ],

      // Enable Bower
      // These JSON files are read in directories
      descriptionFiles: ['package.json', 'bower.json'],

      // These fields in the description files are looked up when trying to resolve the package directory
      mainFields: ['main', 'browser'],

      // These files are tried when trying to resolve a directory
      mainFiles: ['index'],

      // These fields in the description files offer aliasing in this package
      // The content of these fields is an object where requests to a key are mapped to the corresponding value
      aliasFields: ['browser'],

      // These extensions are tried when resolving a file
      extensions: ['.js', '.json'],

      // If false it will also try to use no extension from above
      enforceExtension: false,

      // These extensions are tried when resolving a module
      moduleExtensions: ['-loader'],

      // If false it's also try to use no module extension from above
      enforceModuleExtension: false,
      // These aliasing is used when trying to resolve a module
      // alias: {
      //   jquery: path.resolve(__dirname, 'vendor/jquery-2.0.0.js'),
      // },
    },
  },
}

if (runtime.attachHMR) {
  var bundler = webpack(cfg.webpack)
}

cfg.browsersync = {
  server: {
    port   : runtime.ports.content,
    baseDir: (function dynamicWebRoots () {
      var webRoots = [ runtime.contentBuildDir ]
      if (runtime.extraWebroots) {
        webRoots = webRoots.concat(runtime.extraWebroots)
      }

      // Turn into absolute paths (e.g. `crmdummy` -> `/Users/kvz/code/content/_site/crmdummy` )
      for (let i in webRoots) {
        if (webRoots[i].substr(0, 1) !== '/' && webRoots[i].substr(0, 1) !== '~') {
          webRoots[i] = `${runtime.contentBuildDir}/${webRoots[i]}`
        }
      }

      return webRoots
    }()),
    middleware: (function dynamicMiddlewares () {
      var middlewares = []

      if (runtime.attachHMR) {
        middlewares.push(webpackDevMiddleware(bundler, {
          publicPath: runtime.publicPath,
          hot       : true,
          inline    : true,
          stats     : { colors: true },
        }))
        middlewares.push(webpackHotMiddleware(bundler))
      }

      if (!middlewares.length) {
        return false
      }

      return middlewares
    }()),
    // serveStatic: runtime.themeDir
  },
  watchOptions: {
    ignoreInitial: true,
    ignored      : [
      // no need to watch '*.js' here, webpack will take care of it for us,
      // including full page reloads if HMR won't work
      '*.js',
      '.git',
      'assets/build',
      '.lanyon',
    ],
  },
  reloadDelay: 200,
  files      : runtime.contentBuildDir,
}

cfg.jekyll = {
  gems: (function dynamicGems () {
    let list = []

    if (process.env.LANYON_DISABLE_GEMS) {
      const disabled = process.env.LANYON_DISABLE_GEMS.split(/\s*,\s*/)
      for (let i in runtime.jekyllConfig.gems) {
        let isEnabled = disabled.indexOf(runtime.jekyllConfig.gems[i]) === -1
        if (isEnabled) {
          list.push(runtime.jekyllConfig.gems[i])
        }
      }
    } else {
      list = runtime.jekyllConfig.gems
    }

    if (!list || list.length < 1) {
      return null
    }

    return list
  }()),
  exclude: (function dynamicExcludes () {
    let list = [
      'node_modules',
      'env.sh',
      'env.*.sh',
      '.env.sh',
      '.env.*.sh',
      '.lanyon',
    ]

    if (_.get(runtime, 'jekyllConfig.exclude.length') > 0) {
      list = list.concat(runtime.jekyllConfig.exclude)
    }

    if ('LANYON_EXCLUDE' in process.env && process.env.LANYON_EXCLUDE !== '') {
      list = list.concat(process.env.LANYON_EXCLUDE.split(/\s*,\s*/))
    }

    if (!list || list.length < 1) {
      return null
    }

    return list
  }()),
  include: (function dynamicIncludes () {
    let list = []

    if (_.get(runtime, 'jekyllConfig.include.length') > 0) {
      list = list.concat(runtime.jekyllConfig.include)
    }

    if ('LANYON_INCLUDE' in process.env && process.env.LANYON_INCLUDE !== '') {
      list = list.concat(process.env.LANYON_INCLUDE.split(/\s*,\s*/))
    }

    if (!list || list.length < 1) {
      return null
    }

    return list
  }()),
}

cfg.nodemon = {
  onChangeOnly: true,
  verbose     : true,
  watch       : runtime.contentScandir,
  ignore      : [
    '_site/**',
    '.env.*.sh',
    '.env.sh',
    '.lanyon/**',
    'assets/**',
    'env.*.sh',
    'env.sh',
    'node_modules/**',
    'vendor/**',
  ].concat(runtime.contentIgnore),
  ext: [
    'htm',
    'html',
    'jpg',
    'json',
    'md',
    'png',
    'sh',
    'yml',
  ].join(','),
}

cfg.runtime = runtime

module.exports = cfg
