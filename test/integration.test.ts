import fsp from 'fs/promises'
import { execSync, fork } from 'child_process'
import { resolve, join, extname } from 'path'
import {
  stripANSIColor,
  existsFile,
  assertFilesContent,
  getChunkFileNamesFromLog,
  assertContainFiles,
  deleteFile,
} from './testing-utils'
import * as debug from './utils/debug'

jest.setTimeout(10 * 60 * 1000)

const integrationTestDir = resolve(__dirname, 'integration')
const getPath = (filepath: string) => join(integrationTestDir, filepath)

const getOutputSizeColumnIndex = (line: string): number => {
  let match
  if ((match = /\d+\sK?B/g.exec(line)) !== null) {
    return match.index
  }
  return -1
}

const testCases: {
  name: string
  dir?: string
  skip?: boolean
  args?: string[]
  before?(dir: string): Promise<void> | void
  expected(
    f: string,
    { stderr, stdout }: { stderr: string; stdout: string },
  ): Promise<void> | void
}[] = [
  {
    name: 'ts-error',
    async expected(dir, { stdout, stderr }) {
      const distFile = join(dir, './dist/index.js')
      expect(stderr).toMatch(/Could not load TypeScript compiler/)
      expect(await existsFile(distFile)).toBe(false)
    },
  },
  {
    name: 'ts-import-json',
    async expected(dir) {
      assertFilesContent(dir, {
        './dist/index.js': /"0.0.1"/,
        './dist/index.d.ts': /declare const version: string/,
      })
    },
  },
  {
    name: 'pkg-exports',
    async expected(dir) {
      const distFiles = [
        'dist/index.cjs',
        'dist/index.mjs',
        'dist/index.esm.js',
      ]
      assertContainFiles(dir, distFiles)
    },
  },
  {
    name: 'pkg-exports-ts-rsc',
    async expected(dir) {
      await assertFilesContent(dir, {
        './dist/index.mjs': /const shared = true/,
        './dist/react-server.mjs': /'react-server'/,
        './dist/react-native.js': /'react-native'/,
        './dist/index.d.ts': /declare const shared = true/,
        './dist/api.mjs': /\'pkg-export-ts-rsc\'/,
      })
    },
  },
  {
    name: 'pkg-exports-default',
    args: ['index.js'],
    async expected(dir) {
      const distFiles = [
        join(dir, './dist/index.cjs'),
        join(dir, './dist/index.mjs'),
      ]
      for (const f of distFiles) {
        expect(await existsFile(f)).toBe(true)
      }
      const cjsFile = await fsp.readFile(join(dir, './dist/index.cjs'), {
        encoding: 'utf-8',
      })
      expect(cjsFile).toContain(
        `function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }`,
      )
      expect(cjsFile).toContain(
        `Object.defineProperty(exports, '__esModule', { value: true });`,
      )
    },
  },
  {
    name: 'multi-entries',
    async expected(dir, { stdout }) {
      const contentsRegex = {
        './dist/index.js': /'index'/,
        './dist/shared/index.mjs': /'shared'/,
        './dist/shared/edge-light.mjs': /'shared.edge-light'/,
        './dist/server/edge.mjs': /'server.edge-light'/,
        './dist/server/react-server.mjs': /'server.react-server'/,
        // types
        './dist/server/index.d.ts': `export { Client } from '../client/index.cjs';\nexport { Shared } from '../shared/index.cjs';`,
        './dist/client/index.d.mts': `export { Shared } from '../shared/index.mjs'`,
        './dist/client/index.d.cts': `export { Shared } from '../shared/index.cjs'`,
        './dist/client/index.d.ts': `export { Shared } from '../shared/index.cjs'`,
      }

      await assertFilesContent(dir, contentsRegex)

      const log = `\
      dist/shared/index.d.mts
      dist/index.d.ts
      dist/server/index.d.ts
      dist/server/index.d.mts
      dist/lite.d.ts
      dist/server/edge.d.mts
      dist/shared/edge-light.d.mts
      dist/server/react-server.d.mts
      dist/client/index.d.ts
      dist/client/index.d.cts
      dist/client/index.d.mts
      dist/shared/edge-light.mjs
      dist/shared/index.mjs
      dist/index.js
      dist/client/index.cjs
      dist/client/index.mjs
      dist/lite.js
      dist/server/react-server.mjs
      dist/server/edge.mjs
      dist/server/index.mjs
      `

      const rawStdout = stripANSIColor(stdout)
      getChunkFileNamesFromLog(log).forEach((chunk: string) => {
        expect(rawStdout).toContain(chunk)
      })
    },
  },
  {
    name: 'ts-dual-package-type-cjs',
    args: [],
    async expected(dir) {
      assertContainFiles(dir, [
        './dist/index.js',
        './dist/index.mjs',
        './dist/index.d.ts',
        './dist/index.d.mts',
      ])
    },
  },
  {
    name: 'ts-dual-package-module',
    args: [],
    async expected(dir) {
      const distFiles = [
        './dist/index.js',
        './dist/index.cjs',
        './dist/index.d.ts',
        './dist/index.d.cts',
      ]
      assertContainFiles(dir, distFiles)
    },
  },
  {
    name: 'ts-exports-types',
    args: [],
    async expected(dir) {
      const distFiles = [
        './dist/index.mjs',
        './dist/index.cjs',
        './dist/index.d.mts',
        './dist/index.d.cts',
        './dist/index.d.ts',
      ]
      assertContainFiles(dir, distFiles)
    },
  },
  {
    name: 'single-entry',
    async expected(dir, { stdout, stderr }) {
      const distFiles = [
        join(dir, './dist/index.js'),
        join(dir, './dist/index.d.ts'),
      ]
      for (const f of distFiles) {
        expect(await existsFile(f)).toBe(true)
      }
      expect(await fsp.readFile(distFiles[0], 'utf-8')).toContain(
        `Object.defineProperty(exports, '__esModule', { value: true });`,
      )
      expect(await fsp.readFile(distFiles[1], 'utf-8')).toContain(
        'declare const _default: () => string;',
      )

      const log = `\
      dist/index.d.ts
      dist/index.js`

      expect(stderr).not.toContain('Cannot export `exports` field with')

      const rawStdout = stripANSIColor(stdout)
      log.split('\n').forEach((line: string) => {
        expect(rawStdout).toContain(line.trim())
      })
    },
  },
  {
    name: 'ts-allow-js',
    args: [],
    async expected(dir) {
      const distFiles = [
        join(dir, './dist/index.js'),
        join(dir, './dist/index.d.ts'),
      ]
      await assertContainFiles(dir, distFiles)
      expect(await fsp.readFile(distFiles[1], 'utf-8')).toContain(
        'declare function _default(): string;',
      )
    },
  },
  {
    name: 'ts-incremental',
    args: [],
    async expected(dir) {
      // TODO: disable incremental and avoid erroring
      const distFiles = ['./dist/index.js', './dist/index.d.ts']

      await assertContainFiles(dir, distFiles)
      expect(await fsp.readFile(join(dir, distFiles[1]), 'utf-8')).toContain(
        'declare const _default: () => string;',
      )
      expect(await existsFile(join(dir, './dist/.tsbuildinfo'))).toBe(false)
    },
  },
  {
    name: 'ts-incremental-with-buildinfofile',
    args: [],
    async expected(dir) {
      // TODO: disable incremental and avoid erroring
      const distFiles = ['./dist/index.js', './dist/index.d.ts']
      await assertContainFiles(dir, distFiles)

      expect(await fsp.readFile(join(dir, distFiles[1]), 'utf-8')).toContain(
        'declare const _default: () => string;',
      )
      expect(await existsFile(join(dir, './dist/.tsbuildinfo'))).toBe(false)
    },
  },
  {
    name: 'ts-no-emit',
    args: [],
    async expected(dir) {
      // should still emit declaration files
      const distFiles = ['./dist/index.js', './dist/index.d.ts']

      await assertContainFiles(dir, distFiles)
      expect(await fsp.readFile(join(dir, distFiles[1]), 'utf-8')).toContain(
        'declare const _default: () => string;',
      )
      expect(await existsFile(join(dir, './dist/.tsbuildinfo'))).toBe(false)
    },
  },
  {
    name: 'wildcard-exports',
    args: [],
    async expected(dir, { stdout, stderr }) {
      const contentsRegex = {
        './dist/index.js': /'index'/,
        './dist/layout/index.js': /'layout'/,
        './dist/server/edge.mjs': /'server.edge-light'/,
        './dist/server/react-server.mjs': /'server.react-server'/,
      }

      await assertFilesContent(dir, contentsRegex)

      const log = `\
      dist/button.d.ts
      dist/server/index.d.ts
      dist/server/index.d.mts
      dist/index.d.ts
      dist/layout/index.d.ts
      dist/server/react-server.d.mts
      dist/lite.d.ts
      dist/server/edge.d.mts
      dist/input.d.ts
      dist/input.js
      dist/lite.js
      dist/button.js
      dist/index.js
      dist/server/react-server.mjs
      dist/layout/index.js
      dist/server/index.mjs
      dist/server/edge.mjs
      `

      const rawStdout = stripANSIColor(stdout)
      getChunkFileNamesFromLog(log).forEach((chunk: string) => {
        expect(rawStdout).toContain(chunk)
      })
      expect(stderr).toContain('is experimental')
    },
  },
  {
    name: 'no-entry',
    args: [],
    async expected(_dir, { stderr }) {
      const log =
        'The "src" directory does not contain any entry files. ' +
        'For proper usage, please refer to the following link: ' +
        'https://github.com/huozhi/bunchee#usage'
      expect(stderr).toContain(log)
    },
  },
  {
    name: 'raw-data',
    args: [],
    async expected(dir) {
      const distFile = join(dir, './dist/index.js')
      expect(await existsFile(distFile)).toBe(true)
      expect(await fsp.readFile(distFile, 'utf-8')).toContain(`"thisismydata"`)
    },
  },
  {
    name: 'server-components',
    args: [],
    async expected(dir) {
      const distFiles = await fsp.readdir(join(dir, 'dist'))

      const requiredFiles = [
        join(dir, 'dist/index.js'),
        join(dir, 'dist/index.cjs'),
        join(dir, 'dist/ui.js'),
        join(dir, 'dist/ui.cjs'),
      ]
      for (const f of requiredFiles) {
        expect(await existsFile(f)).toBe(true)
      }

      // split chunks
      const indexContent = await fsp.readFile(
        join(dir, 'dist/index.js'),
        'utf-8',
      )
      expect(indexContent).not.toContain('use server')
      expect(indexContent).not.toContain('use client')

      // client component chunks will remain the directive
      const clientClientChunkFiles = distFiles.filter((f) =>
        f.includes('client-client-'),
      )
      clientClientChunkFiles.forEach(async (f) => {
        const content = await fsp.readFile(join(dir, 'dist', f), 'utf-8')
        expect(content).toContain('use client')
      })
      // cjs and esm, check the extension and files amount
      expect(clientClientChunkFiles.map((f) => extname(f)).sort()).toEqual([
        '.cjs',
        '.js',
      ])

      // asset is only being imported to ui, no split
      const assetClientChunkFiles = distFiles.filter((f) =>
        f.includes('_asset-client-'),
      )
      expect(assetClientChunkFiles.length).toBe(0)

      // server component chunks will remain the directive
      const serverChunkFiles = distFiles.filter((f) =>
        f.includes('_actions-server-'),
      )
      serverChunkFiles.forEach(async (f) => {
        const content = await fsp.readFile(join(dir, 'dist', f), 'utf-8')
        expect(content).toContain('use server')
        expect(content).not.toContain('use client')
      })
      // cjs and esm, check the extension and files amount
      expect(serverChunkFiles.map((f) => extname(f)).sort()).toEqual([
        '.cjs',
        '.js',
      ])

      // For single entry ./ui, client is bundled into client
      const uiEsm = await fsp.readFile(join(dir, 'dist/ui.js'), 'utf-8')
      expect(uiEsm).toContain('use client')
      expect(uiEsm).not.toContain('./_client-client')

      // asset is only being imported to ui, no split
      expect(uiEsm).not.toContain('./_asset-client')
    },
  },
  {
    name: 'server-components-same-layer',
    args: [],
    async expected(dir) {
      const distFiles = await fsp.readdir(join(dir, 'dist'))
      const clientChunkFiles = distFiles.filter((f) =>
        f.includes('client-client-'),
      )
      expect(clientChunkFiles.length).toBe(0)

      // index doesn't have "use client" directive
      const indexCjs = await fsp.readFile(join(dir, 'dist/index.cjs'), 'utf-8')
      const indexEsm = await fsp.readFile(join(dir, 'dist/index.js'), 'utf-8')
      expect(indexCjs).toContain('use client')
      expect(indexEsm).toContain('use client')
    },
  },
  {
    name: 'shared-entry',
    args: [],
    async expected(dir) {
      const distFiles = [
        './dist/index.js',
        './dist/index.mjs',
        './dist/shared.js',
        './dist/shared.mjs',
      ]
      assertContainFiles(dir, distFiles)

      // ESM bundle imports from <pkg/export>
      const indexEsm = await fsp.readFile(
        join(dir, './dist/index.mjs'),
        'utf-8',
      )
      expect(indexEsm).toContain('shared-entry/shared')
      expect(indexEsm).toContain('index-export')
      expect(indexEsm).not.toMatch(/['"]\.\/shared['"]/)
      expect(indexEsm).not.toContain('shared-export')

      // CJS bundle imports from <pkg/export>
      const indexCjs = await fsp.readFile(join(dir, './dist/index.js'), 'utf-8')
      expect(indexCjs).toContain('shared-entry/shared')
      expect(indexCjs).toContain('index-export')
      expect(indexCjs).not.toMatch(/['"]\.\/shared['"]/)

      // shared entry contains its own content
      const sharedEsm = await fsp.readFile(
        join(dir, './dist/shared.mjs'),
        'utf-8',
      )
      expect(sharedEsm).toContain('shared-export')

      // shared entry contains its own content
      const sharedCjs = await fsp.readFile(
        join(dir, './dist/shared.js'),
        'utf-8',
      )
      expect(sharedCjs).toContain('shared-export')
    },
  },
  {
    name: 'output',
    args: [],
    async expected(dir, { stdout }) {
      /*
      output:

      Exports          File                        Size
      cli (bin)        dist/cli.js                 103 B
      .                dist/index.js               42 B
      . (react-server) dist/index.react-server.js  55 B
      ./foo            dist/foo.js                 103 B
      */

      const lines = stripANSIColor(stdout).split('\n')
      const [tableHeads, cliLine, indexLine, indexReactServerLine, fooLine] =
        lines
      expect(tableHeads).toContain('Exports')
      expect(tableHeads).toContain('File')
      expect(tableHeads).toContain('Size')

      expect(cliLine).toContain('cli (bin)')
      expect(cliLine).toContain('dist/cli.js')

      expect(indexLine).toContain('.')
      expect(indexLine).toContain('dist/index.js')

      expect(indexReactServerLine).toContain('. (react-server)')
      expect(indexReactServerLine).toContain('dist/index.react-server.js')

      expect(fooLine).toContain('./foo')
      expect(fooLine).toContain('dist/foo.js')

      const [exportsIndex, fileIndex, sizeIndex] = [
        tableHeads.indexOf('Exports'),
        tableHeads.indexOf('File'),
        tableHeads.indexOf('Size'),
      ]

      expect(cliLine.indexOf('cli (bin)')).toEqual(exportsIndex)
      expect(cliLine.indexOf('dist/cli.js')).toEqual(fileIndex)
      expect(getOutputSizeColumnIndex(cliLine)).toEqual(sizeIndex)

      expect(indexLine.indexOf('.')).toEqual(exportsIndex)
      expect(indexLine.indexOf('dist/index.js')).toEqual(fileIndex)
      expect(getOutputSizeColumnIndex(indexLine)).toEqual(sizeIndex)

      expect(indexReactServerLine.indexOf('. (react-server)')).toEqual(
        exportsIndex,
      )
      expect(
        indexReactServerLine.indexOf('dist/index.react-server.js'),
      ).toEqual(fileIndex)
      expect(getOutputSizeColumnIndex(indexReactServerLine)).toEqual(sizeIndex)

      expect(fooLine.indexOf('./foo')).toEqual(exportsIndex)
      expect(fooLine.indexOf('dist/foo.js')).toEqual(fileIndex)
      expect(getOutputSizeColumnIndex(fooLine)).toEqual(sizeIndex)
    },
  },
  {
    name: 'output-short',
    args: [],
    async expected(dir, { stdout, stderr }) {
      /*
      output:

      Exports File          Size
      .       dist/index.js 30 B
      */
      const [tableHeads, indexLine] = stripANSIColor(stdout).split('\n')
      expect(tableHeads).toContain('Exports')
      expect(tableHeads).toContain('File')
      expect(tableHeads).toContain('Size')

      expect(indexLine).toContain('.')
      expect(indexLine).toContain('dist/index.js')

      const [exportsIndex, fileIndex, sizeIndex] = [
        tableHeads.indexOf('Exports'),
        tableHeads.indexOf('File'),
        tableHeads.indexOf('Size'),
      ]

      expect(indexLine.indexOf('.')).toEqual(exportsIndex)
      expect(indexLine.indexOf('dist/index.js')).toEqual(fileIndex)
      expect(getOutputSizeColumnIndex(indexLine)).toEqual(sizeIndex)
    },
  },
  {
    name: 'prepare-js',
    args: ['--prepare'],
    async before(dir) {
      await fsp.writeFile(join(dir, './package.json'), '{ "type": "commonjs" }')
    },
    async expected(dir, { stdout }) {
      assertContainFiles(dir, ['package.json'])
      const pkgJson = JSON.parse(
        await fsp.readFile(join(dir, './package.json'), 'utf-8'),
      )
      expect(pkgJson.main).toBe('./dist/index.js')
      expect(pkgJson.module).toBe('./dist/index.mjs')
      expect(pkgJson.types).toBeFalsy()
      expect(pkgJson.files).toContain('dist')
      expect(pkgJson.bin).toBe('./dist/bin/index.js')
      expect(pkgJson.exports).toEqual({
        './foo': {
          import: './dist/foo.mjs',
          require: './dist/foo.js',
        },
        '.': {
          import: './dist/index.mjs',
          require: './dist/index.js',
        },
      })

      /*
        Discovered binaries entries:
          .: bin.js
        Discovered exports entries:
          ./foo: foo.js
          .    : index.js
        ✓ Configured `exports` in package.json
      */
      expect(stdout).toContain('Discovered binaries entries:')
      expect(stdout).toMatch(/.\s*: bin.js/)
      expect(stdout).toContain('Discovered exports entries:')
      expect(stdout).toMatch(/\.\/foo\s*: foo.js/)
      expect(stdout).toMatch(/\.\s*: index.js/)
      expect(stripANSIColor(stdout)).toContain(
        '✓ Configured `exports` in package.json',
      )
    },
  },
  {
    name: 'prepare-ts',
    args: ['--prepare'],
    async before(dir) {
      await deleteFile(join(dir, './package.json'))
      await deleteFile(join(dir, './tsconfig.json'))
    },
    async expected(dir, { stdout }) {
      assertContainFiles(dir, ['package.json'])
      const pkgJson = JSON.parse(
        await fsp.readFile(join(dir, './package.json'), 'utf-8'),
      )
      expect(pkgJson.files).toContain('dist')
      expect(pkgJson.bin).toEqual({
        cli: './dist/bin/cli.js',
        cmd: './dist/bin/cmd.js',
      })
      expect(pkgJson.type).toBe('module')
      expect(pkgJson.main).toBe('./dist/es/index.js')
      expect(pkgJson.module).toBe('./dist/es/index.js')
      expect(pkgJson.exports).toEqual({
        './foo': {
          import: {
            types: './dist/es/foo.d.ts',
            default: './dist/es/foo.js',
          },
          require: {
            types: './dist/cjs/foo.d.cts',
            default: './dist/cjs/foo.cjs',
          },
        },
        '.': {
          'react-server': './dist/es/index-react-server.mjs',
          import: {
            types: './dist/es/index.d.ts',
            default: './dist/es/index.js',
          },
          require: {
            types: './dist/cjs/index.d.cts',
            default: './dist/cjs/index.cjs',
          },
        },
      })

      /*
        Discovered binaries entries:
          ./cli: cli.ts
          ./cmd: cmd.ts
        Discovered exports entries:
          ./foo: foo.ts
          .    : index.react-server.ts
          .    : index.ts
        ✓ Configured `exports` in package.json
      */
      expect(stripANSIColor(stdout)).toContain(
        'Detected using TypeScript but tsconfig.json is missing, created a tsconfig.json for you.',
      )
      expect(stdout).toContain('Discovered binaries entries:')
      expect(stdout).toMatch(/\.\s*: index.ts/)
      expect(stdout).toContain('Discovered exports entries:')
      expect(stdout).toMatch(/\.\/foo\s*: foo.ts/)
      expect(stdout).toMatch(/\.\s*: index.react-server.ts/)
      expect(stripANSIColor(stdout)).toContain(
        '✓ Configured `exports` in package.json',
      )
    },
  },
  {
    name: 'prepare-ts-with-test-file',
    args: ['--prepare'],
    async before(dir) {
      await deleteFile(join(dir, './package.json'))
      await deleteFile(join(dir, './tsconfig.json'))
    },
    async expected(dir) {
      assertContainFiles(dir, ['package.json'])
      const pkgJson = JSON.parse(
        await fsp.readFile(join(dir, './package.json'), 'utf-8'),
      )
      expect(pkgJson.files).toContain('dist')
      expect(pkgJson.main).toBe('./dist/es/index.js')
      expect(pkgJson.module).toBe('./dist/es/index.js')
      expect(Object.keys(pkgJson.exports)).toEqual(['.'])
      expect(Object.keys(pkgJson.exports['.'])).not.toContain('./test')
    },
  },
  {
    name: 'prepare-ts-with-pkg-json',
    args: ['--prepare'],
    async before(dir) {
      await fsp.writeFile(
        join(dir, './package.json'),
        '{ "name": "prepare-ts-with-pkg-json" }',
      )
      await deleteFile(join(dir, './tsconfig.json'))
    },
    async expected(dir) {
      assertContainFiles(dir, ['package.json'])
      const pkgJson = JSON.parse(
        await fsp.readFile(join(dir, './package.json'), 'utf-8'),
      )
      expect(pkgJson.files).toContain('dist')
      expect(pkgJson.type).toBeUndefined()
      expect(pkgJson.main).toBe('./dist/cjs/index.js')
      expect(pkgJson.module).toBe('./dist/es/index.mjs')
    },
  },
  {
    name: 'no-clean',
    args: ['--no-clean'],
    async before(dir) {
      execSync(`rm -rf ${join(dir, 'dist')}`)
      await fsp.mkdir(join(dir, 'dist'))
      await fsp.writeFile(join(dir, './dist/no-clean.json'), '{}')
    },
    async expected(dir) {
      const distFiles = [join(dir, './dist/no-clean.json')]
      for (const f of distFiles) {
        expect(await existsFile(f)).toBe(true)
      }
    },
  },
  {
    name: 'no-clean',
    args: [],
    async before(dir) {
      execSync(`rm -rf ${join(dir, 'dist')}`)
      await fsp.mkdir(join(dir, 'dist'))
      await fsp.writeFile(join(dir, './dist/no-clean.json'), '{}')
    },
    async expected(dir) {
      expect(await existsFile(join(dir, './dist/no-clean.json'))).toBe(false)
      expect(await existsFile(join(dir, './dist/index.js'))).toBe(true)
    },
  },
  {
    name: 'ts-composite',
    dir: 'monorepo-composite/packages/a',
    async expected(dir) {
      expect(await existsFile(join(dir, './dist/index.js'))).toBe(true)
      expect(await existsFile(join(dir, './dist/index.d.ts'))).toBe(true)
    },
  },
  {
    name: 'ts-composite-without-incremental',
    dir: 'monorepo-composite-no-incremental/packages/a',
    async expected(dir) {
      expect(await existsFile(join(dir, './dist/index.js'))).toBe(true)
      expect(await existsFile(join(dir, './dist/index.d.ts'))).toBe(true)
    },
  },
]

async function runBundle(
  dir: string,
  args_: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const assetPath = process.env.POST_BUILD
    ? '/../dist/bin/cli.js'
    : '/../src/bin/index.ts'

  const args = (args_ || []).concat(['--cwd', dir])
  const ps = fork(
    `${require.resolve('tsx/cli')}`,
    [__dirname + assetPath].concat(args),
    { stdio: 'pipe' },
  )
  let stderr = '',
    stdout = ''
  ps.stdout?.on('data', (chunk) => (stdout += chunk.toString()))
  ps.stderr?.on('data', (chunk) => (stderr += chunk.toString()))
  return new Promise((resolve) => {
    ps.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr,
      })
    })
  })
}

function runTests() {
  for (const testCase of testCases) {
    const { name, args = [], expected, before, skip } = testCase
    const dir = getPath(testCase.dir ?? name)
    if (skip) {
      return
    }
    test(`integration ${name}`, async () => {
      debug.log(`Command: bunchee ${args.join(' ')}`)
      if (before) {
        await before(dir)
      }
      const { stdout, stderr } = await runBundle(dir, args)

      stdout && debug.log(stdout)
      stderr && debug.error(stderr)

      await expected(dir, { stdout, stderr })
    })
  }
}

runTests()
