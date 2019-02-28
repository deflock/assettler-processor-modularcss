import nodepath from 'path';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

const PLUGIN_NAME = 'postcss-modularcss-asset';

/**
 *
 */
export default postcss.plugin(PLUGIN_NAME, (opts = {}) => {
    const options = Object.assign({}, opts);

    return (css, result) => {
        css.walkDecls(decl => {
            transform(decl, 'value', options, result);
        });
    };
});

/**
 * @param {Object} node
 * @param {string} property
 * @param {Object} options
 * @param {Object} result
 */
function transform(node, property, options, result) {
    if (node[property]) {
        node[property] = processValue(node[property], node, options);
    }
}

/**
 * @param {string} value
 * @param {Object} decl
 * @param {Object} options
 * @returns {string}
 */
function processValue(value, decl, options) {
    const {
        publicDir,
        resourceBasedir,
        assetResolver,
    } = options;

    if (!publicDir) {
        throw new Error('Public directory not set');
    }

    const declfile = decl.source && decl.source.input && decl.source.input.file;

    return valueParser(value).walk(node => {
        if (node.type === 'function') {
            if (node.value === 'url') {
                if (node.nodes.length === 1 && (node.nodes[0].type === 'word' || node.nodes[0].type === 'string')) {
                    const val = node.nodes[0].value;

                    // Ignore absolute urls, data URIs, or hashes
                    if (val.indexOf('/') === 0
                        || val.indexOf('data:') === 0
                        || val.indexOf('#') === 0
                        || /^[a-z]+:\/\//i.test(val)
                    ) {
                        return;
                    }

                    const fullpath = nodepath.resolve(nodepath.dirname(declfile), val);
                    const resource = nodepath.relative(resourceBasedir, fullpath);

                    node.nodes[0].value = assetResolver.fromResource(resource);
                }
            }
        }
    }, true).toString();
}
