import { readFile } from 'fs/promises'
import { createIntegrationTest, existsFile } from '../../utils'

describe('integration bin/multi-path', () => {
  it('should work with bin as multi path', async () => {
    await createIntegrationTest(
      {
        directory: __dirname,
      },
      async ({ distDir }) => {
        const distBinFiles = [`${distDir}/bin/a.js`, `${distDir}/bin/b.js`]
        const distTypeFiles = [`${distDir}/bin/a.d.ts`, `${distDir}/bin/b.d.ts`]
        const distFiles = distBinFiles.concat(distTypeFiles)

        for (const distFile of distFiles) {
          expect(await existsFile(distFile)).toBe(true)
        }
        for (const distScriptFile of distBinFiles) {
          expect(await readFile(distScriptFile, 'utf-8')).toContain(
            '#!/usr/bin/env node',
          )
        }
      },
    )
  })
})
