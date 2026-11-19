#!/usr/bin/env node
// 临时静态服务：node serve.mjs <目录> [端口=8931]
// 供 playwright 访问本地 HTML（file: 协议被禁）。
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, normalize, resolve, sep } from 'node:path'

const [dir = '.', port = '8931'] = process.argv.slice(2)
const root = resolve(dir)

createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent((req.url || '/').split('?')[0])
    const file = normalize(join(root, rel))
    if (file !== root && !file.startsWith(root + sep)) throw new Error('out of root')
    const data = await readFile(file)
    res.writeHead(200, {
      'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream'
    })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('nf')
  }
}).listen(Number(port), '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}`)
})
