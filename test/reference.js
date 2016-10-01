/* global describe, it */
'use strict';

var assert = assert || require('assert'),
    jsen = jsen || require('../index.js');

// Reference: https://tools.ietf.org/html/rfc6901
describe('JSON Pointer', function () {
    var doc = {
            foo: ['bar', 'baz'],
            '': 0,
            'a/b': 1,
            'c%d': 2,
            'e^f': 3,
            'g|h': 4,
            'i\\j': 5,
            'k\"l': 6,
            ' ': 7,
            'm~n': 8,
            'k\'l': 9
        },
        expected = [doc, doc.foo, 'bar', 0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        i;

    it('resolver conforms to JSON Pointer spec and decodes URI-encoded pointers', function () {
        var paths = [
            '#',
            '#/foo',
            '#/foo/0',
            '#/',
            '#/a~1b',
            '#/c%25d',
            '#/e%5Ef',
            '#/g%7Ch',
            '#/i%5Cj',
            '#/k%22l',
            '#/%20',
            '#/m~0n',
            '#/k\'l'
        ];

        for (i = 0; i < paths.length; i++) {
            assert.strictEqual(expected[i], jsen.resolve(doc, paths[i]));
        }
    });

    it('resolver does not parse $refs without # as JSON pointer', function () {
        var schema = {
                id: 'http://jsen.bis/schemaA',
                'http://jsen.bis/schemaB': {
                    type: 'number'
                },
                type: 'object',
                properties: {
                    foo: { $ref: 'http://jsen.bis/schemaB' }
                }
            },
            validate = jsen(schema);

        assert.strictEqual(schema['http://jsen.bis/schemaB'], jsen.resolve(schema, 'http://jsen.bis/schemaB'));

        assert(validate({ foo: 123 }));
        assert(!validate({ foo: '123' }));
    });

    it('resolver parses $refs that do not start with `#`', function () {
        var schema = {
                id: 'http://jsen.bis/schemaA',
                definitions: {
                    foo: {
                        id: 'http://jsen.bis/schemaA#bar',
                        type: 'string'
                    },
                    foo2: { type: 'object' },
                    baz: { type: 'array' }
                },
                bar: { type: 'number' },
                '/definitions/baz': { type: 'boolean' },
                'http://jsen.bis/schemaA#/definitions/foo2': { type: 'null' },
                properties: {
                    foo: { $ref: 'http://jsen.bis/schemaA#bar' },
                    foo2: { $ref: 'http://jsen.bis/schemaA#/definitions/foo2' },
                    bar: { $ref: '#/bar' },
                    baz: { $ref: '/definitions/baz' }
                }
            },
            validate = jsen(schema);

        assert(validate({ foo: 'abc' }));
        assert(!validate({ foo: 123 }));

        assert(validate({ foo2: {} }));
        assert(!validate({ foo2: null }));

        assert(validate({ bar: 123 }));
        assert(!validate({ bar: '123' }));

        assert(validate({ baz: false }));
        assert(!validate({ baz: [] }));
    });
});

describe('SchemaResolver', function () {
    var SchemaResolver = require('../lib/resolver.js');

    it('resolve() returns non-object schema arguments', function () {
        var resolver = new SchemaResolver({}),
            arr = [];

        assert.strictEqual(resolver.resolve(), undefined);
        assert.strictEqual(resolver.resolve(null), null);
        assert.strictEqual(resolver.resolve(123), 123);
        assert.strictEqual(resolver.resolve(''), '');
        assert.strictEqual(resolver.resolve(arr), arr);
    });

    it('resolve() returns original object if no $ref', function () {
        var resolver = new SchemaResolver({}),
            obj = {};

        assert.strictEqual(resolver.resolve(obj), obj);
    });
});

describe('$ref', function () {
    it('throws if string is not in correct format', function () {
        assert.throws(function () {
            jsen({ $ref: '' });
        });

        assert.throws(function () {
            jsen({ $ref: '#double//slash' });
        });

        assert.throws(function () {
            jsen({ $ref: '#ends/with/slash/' });
        });

        assert.throws(function () {
            // invalid reference, non-existent schema properties
            jsen({ $ref: '#a/b/c' });
        });

        assert.doesNotThrow(function () {
            // schema resolves to itself
            jsen({ $ref: '#' });
        });

        assert.doesNotThrow(function () {
            jsen({
                a: {
                    b: {
                        c: {
                            type: 'any'
                        }
                    }
                },
                $ref: '#/a/b/c'
            });
        });

        assert.doesNotThrow(function () {
            jsen({
                arr: [
                    { value: { type: 'string'} },
                    { value: { type: 'number'} },
                    { value: { type: 'boolean'} }
                ],
                type: 'object',
                properties: {
                    a: { $ref: '#arr/2/value' }
                }
            });
        });
    });

    describe('external schema', function () {
        it('finds external schema with a hash', function () {
            var external = { type: 'string' },
                schema = { $ref: '#external' },
                validate = jsen(schema, {
                    schemas: {
                        external: external
                    }
                });

            assert(validate('abc'));
            assert(!validate(123));
        });

        it('finds external schema without a hash', function () {
            var external = { type: 'string' },
                schema = { $ref: 'external' },
                validate = jsen(schema, {
                    schemas: {
                        external: external
                    }
                });

            assert(validate('abc'));
            assert(!validate(123));
        });

        it('throws when no external schema found', function () {
            var schema = { $ref: '#external' };

            assert.throws(function () {
                jsen(schema);
            });
        });

        it('own property takes precendence over external schema', function () {
            var external = { type: 'string' },
                schema = {
                    external: { type: 'number' },
                    $ref: '#external'
                },
                validate = jsen(schema, {
                    schemas: {
                        external: external
                    }
                });

            assert(!validate('abc'));
            assert(validate(123));
        });

        it('external schemas have their own dereferencing scope', function () {
            var external = {
                    inner: { type: 'string' },
                    $ref: '#inner'
                },
                schema = {
                    inner: { type: 'number' },
                    $ref: '#external'
                },
                validate = jsen(schema, {
                    schemas: {
                        external: external
                    }
                });

            assert(validate('abc'));
            assert(!validate(123));
        });
    });

    describe('scope resolution', function () {
        it('changes scope through id', function () {
            var schema = {
                    id: 'http://x.y.z/rootschema.json#',
                    type: 'number',
                    schema1: {
                        id: '#foo',
                        type: 'string'
                    },
                    schema2: {
                        id: 'otherschema.json',
                        nested: {
                            id: '#bar',
                            type: 'boolean'
                        },
                        alsonested: {
                            id: 't/inner.json#a',
                            type: 'array'
                        },
                        enum: [1, 2, 3]
                    },
                    schema3: {
                        id: 'some://where.else/completely#',
                        type: 'object'
                    }
                },
                expectedValid = {
                    '#schema2': 1,
                    '#/schema2': 1,
                    'http://x.y.z/rootschema.json#foo': 'abc',
                    'http://x.y.z/otherschema.json#': 2,
                    'http://x.y.z/otherschema.json#bar': false,
                    'http://x.y.z/t/inner.json#a': [],
                    'some://where.else/completely#': {}
                },
                expectedInvalid = {
                    '#/schema2': 4,
                    '#schema2': 4,
                    'http://x.y.z/rootschema.json#foo': 123,
                    'http://x.y.z/otherschema.json#': 0,
                    'http://x.y.z/otherschema.json#bar': null,
                    'http://x.y.z/t/inner.json#a': true,
                    'some://where.else/completely#': null
                };

            Object.keys(expectedValid).forEach(function (key) {
                var schemaCopy = JSON.parse(JSON.stringify(schema)),
                    validate;

                schemaCopy.$ref = key;

                assert.doesNotThrow(function () {
                    validate = jsen(schemaCopy);
                });

                assert(validate(expectedValid[key]));
                assert(!validate(expectedInvalid[key]));
            });
        });
    });

    describe('recursive resolution', function () {
        it('throws on self-referencing schema', function () {
            assert.throws(function () {
                jsen({
                    id: 'http://x.y.z/rootschema.json#',
                    $ref: 'http://x.y.z/rootschema.json#',
                    type: 'number'
                });
            });

            assert.throws(function () {
                jsen({
                    id: 'http://x.y.z/rootschema.json#',
                    definitions: {
                        number: {
                            type: 'number'
                        }
                    },
                    $ref: 'http://x.y.z/rootschema.json#/definitions/number'
                });
            });

            assert.doesNotThrow(function () {
                var validate = jsen({
                    id: 'http://x.y.z/rootschema.json#',
                    definitions: {
                        number: {
                            type: 'number'
                        }
                    },
                    $ref: '#/definitions/number'
                });

                assert(validate(123));
                assert(!validate(''));
            });
        });

        it('throws on circular reference', function () {
            var schema = {
                definitions: {
                    a: { $ref: '#/definitions/b'},
                    b: { $ref: '#/definitions/c' },
                    c: { $ref: '#/definitions/a' }
                },
                $ref: '#/definitions/a'
            };

            jsen(schema);
        });

        it('does not throw on non-circular reference', function () {
            var schema = {
                    definitions: {
                        a: { type: 'integer' },
                        b: { $ref: '#/definitions/a' },
                        c: { $ref: '#/definitions/b' }
                    },
                    $ref: '#/definitions/c'
                },
                validate = jsen(schema);

            assert(validate(123));
            assert(!validate(Math.PI));
        });
    });
});