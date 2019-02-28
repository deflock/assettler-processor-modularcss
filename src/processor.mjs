import nodepath from 'path';
import nodefs from 'fs';
import {sha1} from '@deflock/crypto';
import ModularCssProcessor from '@modular-css/processor';
import postcssScss from 'postcss-scss';
import postcssAdvancedVariables from 'postcss-advanced-variables';
import postcssAtRoot from 'postcss-atroot';
import postcssColorFunction from 'postcss-color-function';
import postcssColorHexAlpha from 'postcss-color-hex-alpha';
import postcssColorMin from 'postcss-colormin';
import postcssDiscardComments from 'postcss-discard-comments';
import postcssDiscardEmpty from 'postcss-discard-empty';
import postcssFunctions from 'postcss-functions';
import postcssImport from 'postcss-import';
import postcssInlineSvg from 'postcss-inline-svg';
import postcssHexRgba from 'postcss-hexrgba';
import postcssMediaMinmax from 'postcss-media-minmax';
import postcssMixins from 'postcss-mixins';
import postcssNested from 'postcss-nested';
import postcssNestedAncestors from 'postcss-nested-ancestors';
import postcssNormalizeCharset from 'postcss-normalize-charset';
import postcssNormalizeWhitespace from 'postcss-normalize-whitespace';
import postcssMath from '@deflock/postcss-math';
import postcssConvertInlineComments from '@deflock/postcss-convert-inline-comments';
import postcssPathResolver from './postcss/plugins/path-resolver/index';
// import postcssDebug from '@deflock/postcss-debug';
import postcssUseContextPlugin from '@deflock/postcss-use-context-plugin';
import postcssImageSize from '@deflock/postcss-image-size';
import postcssImageInline from '@deflock/postcss-image-inline';
import postcssOptimizeInlineSvg from '@deflock/postcss-optimize-inline-svg';
import postcssAsset from './postcss/plugins/asset/index';
import GenericProcessor from '@assettler/core/lib/generic-processor';


/**
 *
 */
export default class Processor extends GenericProcessor {
    /**
     * @param {string} destDir
     * @param {Object} options
     */
    constructor(destDir, options = {}) {
        super(Object.assign({
            extensions: ['.mcss'],
            basedir: process.cwd(),
            env: 'production',
        }, options));

        this.destDir = destDir;
        this.basedir = this.options.basedir;

        this.env = this.options.env;

        this.resourcesToAssetsMap = {};
        this.hashedAssetsMap = {};
        this.selectorsMap = {};

        this.importDependencies = {};

        this.pathResolver = this.options.pathResolver;
        this.assetResolver = this.options.assetResolver;
    }

    /**
     * @param {Object|Array} files
     * @param {Object} params
     * @returns {Promise<any[]>}
     */
    async process(files, params) {
        await super.process(files, params);
        await this.output();
        await Promise.all([
            this.writeAsJson(this.getOption('mapPaths.resourcesToAssetsJson'), this.resourcesToAssetsMap),
            this.writeAsJson(this.getOption('mapPaths.hashedAssetsJson'), this.hashedAssetsMap),
            this.writeAsJson(this.getOption('mapPaths.selectorsJson'), this.selectorsMap),
        ]);
    }

    /**
     * @param {Object} file
     * @param {Object} params
     * @returns {Promise<void>}
     */
    async onInit(file, params) {
        return this.doTrack(file, params);
    }

    /**
     * @param {Object} file
     * @param {Object} params
     * @returns {Promise<void>}
     */
    async onAdd(file, params) {
        return this.doTrack(file, params);
    }

    /**
     * @param {Object} file
     * @param {Object} params
     * @returns {Promise<void>}
     */
    async onChange(file, params) {
        await this.removeFileGraphTree(file.path);
        return this.doTrack(file, params);
    }

    /**
     * @param {Object} file
     * @param {Object} params
     * @returns {Promise<void>}
     */
    async onUnlink(file, params) {
        return this.doUntrack(file, params);
    }

    /**
     * @param {Object} file
     * @param {Object} params
     * @returns {Promise<void>}
     */
    async doTrack(file, params) {
        const relativePath = file.path;
        await this.getModularCssProcessor().file(relativePath);
    }

    /**
     * @param {Object} file
     * @param {Object} params
     * @returns {Promise<void>}
     */
    async doUntrack(file, params) {
        const relativePath = file.path;

        const promise = this.removeFileGraphTree(relativePath);

        if (Object.prototype.hasOwnProperty.call(this.resourcesToAssetsMap, relativePath)) {
            delete this.resourcesToAssetsMap[relativePath];
        }

        if (Object.prototype.hasOwnProperty.call(this.selectorsMap, relativePath)) {
            delete this.selectorsMap[relativePath];
        }

        return promise;
    }

    /**
     * @param {string} relativePath
     * @returns {Promise}
     */
    async invalidateFile(relativePath) {
        await this.removeFileGraphTree(relativePath);
    }

    /**
     * @param {string} relativePath
     * @returns {Promise<void>}
     */
    async removeFileGraphTree(relativePath) {
        const tree = [];
        this.findGraphDependentsTree(nodepath.resolve(this.basedir, relativePath), tree);

        for (const node of tree) {
            try {
                this.getModularCssProcessor().remove(node);
            }
            catch (e) {
                //
            }
            if (this.importDependencies[node]) {
                delete this.importDependencies[node];
            }
        }
    }

    /**
     * @param {string} path
     * @param {Array} tree
     * @param {number} level
     */
    findGraphDependentsTree(path, tree = [], level = 0) {
        if (level > 1000) {
            throw new Error('Looks like infinite loop');
        }

        if (tree.includes(path)) {
            return;
        }

        tree.push(path);

        for (const dep of this.getModularCssProcessor().dependents(path)) {
            try {
                this.findGraphDependentsTree(dep, tree, level + 1);
            }
            catch (e) {
                //
            }
        }

        if (this.importDependencies[path]) {
            for (const dep of this.importDependencies[path]) {
                try {
                    this.findGraphDependentsTree(dep, tree, level + 1);
                }
                catch (e) {
                    //
                }
            }
        }
    }

    /**
     * @returns {Promise.<void>}
     */
    async output() {
        const asset = 'styles.css';
        const assetPath = nodepath.resolve(this.destDir, asset);

        return this.getModularCssProcessor().output({
            // files: [...],
            to: assetPath,
        }).then(async data => {
            if (!data.css) {
                return;
            }

            const hashedAsset = `${sha1(data.css).substr(0, 12)}.css`;
            const hashedAssetPath = nodepath.resolve(this.destDir, hashedAsset);

            await this.writeFile(hashedAssetPath, data.css);

            this.hashedAssetsMap[asset] = hashedAsset;

            for (const relativePath of Object.keys(data.compositions)) {
                const normalizedRelativePath = nodepath.normalize(relativePath);
                this.resourcesToAssetsMap[normalizedRelativePath] = asset;
                this.selectorsMap[normalizedRelativePath] = data.compositions[relativePath];
            }
        });
    }

    /**
     * @returns {Processor}
     */
    getModularCssProcessor() {
        if (!this.modularCssProcessor) {
            this.modularCssProcessor = this.createModularCssProcessor();
        }
        return this.modularCssProcessor;
    }

    /**
     * @returns {Processor}
     */
    createModularCssProcessor() {
        // implement custom plugins: raw

        // let timestamp;

        /*
         * BEFORE MODULAR PLUGINS
         */

        const beforeModularPlugins = [
            // postcssDebug(true, c => {
            //     console.log(`Before plugins: ${nodepath.relative(this.basedir, c?.source?.input?.file)}`);
            //     timestamp = Date.now();
            // }),
            postcssImport({
                resolve: (id, importBasedir) => this.pathResolver.absolute(
                    id, importBasedir, 'css', {isFromDir: true}
                ) || id,
            }),
            postcssConvertInlineComments(),
            // Base functions
            postcssFunctions({
                glob: this.options.baseFunctionsGlobs || [],
            }),
            // postcssDebug(c => c.toString().includes('ui-size')),
            postcssMixins(),
            // Plugin simple-vars replaces all variables values,
            // but does not remove rules thanks to `only` option.
            // Using simple-vars before the advanced vars w/o removing rules
            // allows variables of variables: $$varName
            // postcssSimpleVars({
            //     only: true,
            // }),
            // postcssDebug(false),
            // variables:
            //   var: value
            //   (key1: value1, key2: value2)
            // @if, @else
            // @each $var $index in (key1: value1, key2: value2) {...}
            // @for $i from 1 through 5 by 2
            postcssAdvancedVariables({
                // variables(name, node) {
                //     console.log(name);
                // },
                disable: this.getAdvVarsAtRulesExcept(['if', 'each', 'for']),
                unresolved: 'throw',
            }),
            postcssFunctions({
                functions: {
                    ui_size_var: (varName, sizeName) => {
                    },
                },
            }),
            // color() + hue/saturation/lightness/whiteness/blackness/tint/shade/blend/contrast
            // lighten(#abc, 20%) -> color(#abc tint(20%)), darken(#abc, 20%) -> color(#abc shade(20%))
            postcssColorFunction(),
            ((pluginName, atRuleName) => {
                const contextPlugins = postcssUseContextPlugin({
                    name: pluginName,
                    atRuleName,
                    plugins: new Map([
                        // math(), round(), floor(), ceil(), abs(), ...
                        ['math', postcssMath()],
                        // rgba(#000, 0.4)
                        ['hex-rgba', postcssHexRgba()],
                        // #9d9c
                        ['hex-alpha', postcssColorHexAlpha()],
                        // (width >= 1200)
                        ['media-minmax', postcssMediaMinmax()],
                    ]),
                });
                contextPlugins.postcssPlugin = pluginName;
                return contextPlugins;
            })('postcss-use-context-plugin-before', 'use-context-plugin'),
            postcssNestedAncestors(),
            postcssNested(),
            (c, r) => {
                /*
                 * Collect @import dependencies
                 * This information we can use when invalidating changed files
                 */
                for (const msg of r.messages || []) {
                    if (msg.type !== 'dependency') {
                        continue;
                    }
                    const {file, parent} = msg;
                    if (!this.importDependencies[file]) {
                        this.importDependencies[file] = [];
                    }
                    if (!this.importDependencies[file].includes(parent)) {
                        this.importDependencies[file].push(parent);
                    }
                }
            },
            // postcssDebug(true, c => {
            //     console.log(`Time: ${Date.now() - timestamp}ms`);
            // }),
        ].filter(plugin => plugin != null);

        /*
         * MODULAR PLUGINS
         */

        const modularPlugins = [
            ((pluginName, atRuleName) => {
                const contextPlugins = postcssUseContextPlugin({
                    name: pluginName,
                    atRuleName,
                    plugins: new Map([]),
                });
                contextPlugins.postcssPlugin = pluginName;
                return contextPlugins;
            })('postcss-use-context-plugin-modular', 'use-context-plugin-modular'),
        ].filter(plugin => plugin != null);

        /*
         * AFTER MODULAR PLUGINS
         */

        const afterModularPlugins = [
            // postcssDebug(true, () => {
            //     timestamp = Date.now();
            // }),
            // 'img::logo' -> '../assets/img/logo.png'
            postcssPathResolver({
                pathResolver: this.pathResolver,
            }),
            postcssAsset(Object.assign({}, {
                publicDir: this.destDir,
                resourceBasedir: this.basedir,
                assetResolver: this.assetResolver,
            })),
            ((pluginName, atRuleName) => {
                const contextPlugins = postcssUseContextPlugin({
                    name: pluginName,
                    atRuleName,
                    plugins: new Map([
                        ['math', postcssMath()],
                        ['atroot', postcssAtRoot()],
                        ['image-size', postcssImageSize()],
                        ['image-inline', postcssImageInline()],
                        ['inline-svg', postcssInlineSvg()],
                        ['optimize-inline-svg', postcssOptimizeInlineSvg()],
                    ]),
                });
                contextPlugins.postcssPlugin = pluginName;
                return contextPlugins;
            })('postcss-use-context-plugin-after', 'use-context-plugin-after'),
            // postcssDebug(true, c => {
            //     console.log(`After plugins: ${nodepath.relative(this.basedir, c?.source?.input?.file)}`);
            //     console.log(`Timestamp: ${Date.now() - timestamp}ms`);
            // }),
        ].filter(plugin => plugin != null);

        /*
         * DONE PLUGINS
         */

        const donePlugins = [
            // postcssDebug(true, c => console.log(`DONE: ${c?.source?.input?.file}`)),
            postcssColorMin(),
            postcssDiscardEmpty(),
            postcssNormalizeCharset(),
            this.ifEnv('development', null, postcssDiscardComments()),
            this.ifEnv('development', null, postcssNormalizeWhitespace()),
        ].filter(plugin => plugin != null);

        /*
         * MODULAR PROCESSOR
         */

        return new ModularCssProcessor(Object.assign({
            cwd: this.basedir,
            map: this.env === 'development',
            exportDefaults: false,
            verbose: false,

            syntax: postcssScss,
            parser: postcssScss,

            namer: (filename, selector) => {
                // CSS character escape sequences
                // https://mathiasbynens.be/notes/css-escapes
                //
                // Identifiers may contain the symbols from a to z, from A to Z, from 0 to 9, underscores (_),
                // hyphens (-), non-ASCII symbols or escape sequences for any symbol.
                // They cannot start with a digit, or a hyphen (-) followed by a digit.
                // Identifiers require at least one symbol (i.e. the empty string is not a valid identifier).
                //
                // Leading digits
                // If the first character of an identifier is numeric,
                // you'll need to escape it based on its Unicode code point.
                //
                // Underscores
                // CSS doesn't require you to escape underscores (_) but if it appears at the start of an identifier,
                // I'd recommend doing it anyway to prevent IE6 from ignoring the rule altogether.

                const hash = sha1(filename + selector);
                const parts = [
                    (parseInt(hash.slice(0, 2), 16) % 25 + 10).toString(36),
                    parseInt(hash.slice(2, 10), 16).toString(36).substr(0, 4),
                    parseInt(hash.slice(10, 20), 16).toString(36).substr(0, 6)
                ];
                const unique = `${parts.join('-')}`;

                return this.env === 'development' ? `${selector}--${unique}` : unique;
            },

            resolvers: [
                (srcfile, file) => {
                    const absolute = this.pathResolver.absolute(file, srcfile, 'css', {isFromDir: false});
                    if (!nodefs.existsSync(absolute) || !nodefs.statSync(absolute).isFile()) {
                        throw new Error(
                            `File cannot be found\n\nFrom: ${srcfile}\nFile: ${file}\nResolved to: ${absolute}`
                        );
                    }
                    return absolute;
                },
            ],

            // `rewrite` adds `postcss-url` to `processor.after` plugins
            rewrite: false,

            // before process each file
            before: beforeModularPlugins,
            // against each file during processing
            // the object exported by the CSS file can be manipulated
            processing: modularPlugins,
            // after process every file
            after: afterModularPlugins,
            // after concatenation
            done: donePlugins,
        }, this.options.processorOptions || {}));
    }

    /**
     * @param {string} env
     * @param {Object} plugin
     * @param {Object|null} elsePlugin
     * @returns {Object|null}
     */
    ifEnv(env, plugin, elsePlugin = null) {
        return this.env === env ? plugin : elsePlugin;
    }

    /**
     * @param {string|Array} except
     * @returns {Array}
     */
    getAdvVarsAtRulesExcept(except) {
        const advVarsFeatures = {
            mixin: ['@mixin', '@content', '@include'],
            import: ['@import'],
            if: ['@if', '@else'],
            each: ['@each'],
            for: ['@for'],
        };
        const advVarsFeaturesNames = Object.keys(advVarsFeatures);

        const disabled = [...advVarsFeaturesNames].filter(
            feat => !(Array.isArray(except) ? except : [except]).includes(feat),
        );

        return disabled.reduce((rules, feat) => rules.concat(advVarsFeatures[feat]), []);
    }
}
