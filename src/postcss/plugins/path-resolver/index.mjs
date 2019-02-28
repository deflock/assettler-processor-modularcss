import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

const PLUGIN_NAME = 'postcss-modularcss-path-resolver';

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
    return valueParser(value).walk(node => {
        if (node.type === 'string') {
            const path = resolvePath(node.value, decl, options);
            if (path != null) {
                node.value = path;
            }
        }
        else if (node.type === 'function') {
            if (node.value === 'url' && node.nodes.length === 1 && node.nodes[0].type === 'word') {
                node.nodes[0].value = processValue(node.nodes[0].value, decl, options);
            }
        }
    }, true).toString();
}

/**
 * @param {string} value
 * @param {Object} decl
 * @param {Object} options
 * @returns {string|null}
 */
function resolvePath(value, decl, options) {
    const {
        pathResolver,
    } = options;

    // Ignore absolute urls, data URIs, or hashes
    if (value.indexOf('/') === 0
        || value.indexOf('data:') === 0
        || value.indexOf('#') === 0
        || /^[a-z]+:\/\//i.test(value)
    ) {
        return null;
    }

    const declfile = decl.source && decl.source.input && decl.source.input.file;

    if (value.indexOf('::') === -1 && value[0] !== '.') {
        // Replace only namespaced and relative paths
        return null;
    }

    return pathResolver.relative(value, declfile, null, {
        isFromDir: false,
        prependDot: true,
    });
}
