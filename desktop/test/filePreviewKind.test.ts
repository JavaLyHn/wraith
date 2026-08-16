import { describe, it, expect } from 'vitest'
import { previewKind, MAX_TEXT_BYTES } from '../src/renderer/lib/filePreviewKind'

describe('previewKind 扩展名识别', () => {
  it('代码类扩展名', () => {
    expect(previewKind('Foo.java')).toBe('code')
    expect(previewKind('bar.ts')).toBe('code')
    expect(previewKind('ui.tsx')).toBe('code')
    expect(previewKind('app.py')).toBe('code')
    expect(previewKind('go.mod')).toBe('code')
    expect(previewKind('Cargo.toml')).toBe('code')
    expect(previewKind('db.sql')).toBe('code')
  })
  it('大小写不敏感', () => {
    expect(previewKind('PHOTO.JPG')).toBe('image')
    expect(previewKind('ReadMe.MD')).toBe('markdown')
  })
  it('Markdown 类', () => {
    expect(previewKind('README.md')).toBe('markdown')
    expect(previewKind('notes.markdown')).toBe('markdown')
  })
  it('图片类', () => {
    expect(previewKind('a.png')).toBe('image')
    expect(previewKind('a.jpeg')).toBe('image')
    expect(previewKind('a.gif')).toBe('image')
    expect(previewKind('a.svg')).toBe('image')
    expect(previewKind('a.webp')).toBe('image')
  })
  it('PDF', () => {
    expect(previewKind('report.pdf')).toBe('pdf')
  })
  it('未知扩展名一律 binary', () => {
    expect(previewKind('archive.zip')).toBe('binary')
    expect(previewKind('app.exe')).toBe('binary')
    expect(previewKind('data')).toBe('binary')   // 无扩展名
  })
  it('全路径输入: 取 basename 的扩展名判断,分隔符不影响', () => {
    // Windows 反斜杠
    expect(previewKind('d:\\wraith\\desktop\\src\\renderer\\App.tsx')).toBe('code')
    expect(previewKind('D:\\Wraith\\docs\\设计文档.md')).toBe('markdown')
    expect(previewKind('d:\\wraith\\logo.png')).toBe('image')
    // POSIX 正斜杠
    expect(previewKind('/home/user/project/src/main.py')).toBe('code')
    expect(previewKind('/home/user/project/README.md')).toBe('markdown')
    // 混合分隔符(Windows 上复制出的相对路径偶见)
    expect(previewKind('src/lib\\filePreviewKind.ts')).toBe('code')
  })
  it('带点的目录名: 目录段中的点不参与扩展名判断', () => {
    expect(previewKind('d:\\my.project.v2\\logo.svg')).toBe('image')   // 目录有点,文件正常判
    expect(previewKind('/home/u/node.express/site/')).toBe('binary')   // 尾斜杠 → basename 为空 → binary
    expect(previewKind('v1.2.3')).toBe('binary')                       // 唯一"扩展名"是数字,未匹配 → binary
  })
  it('隐藏文件与特殊命名', () => {
    expect(previewKind('.gitignore')).toBe('binary')        // lastIndexOf('.') 命中首字符,ext='gitignore' 未匹配
    expect(previewKind('env.example')).toBe('binary')       // 'example' 不在集合
    expect(previewKind('Dockerfile')).toBe('binary')        // 无点无扩展名
  })
  it('MAX_TEXT_BYTES = 1.5MB', () => {
    expect(MAX_TEXT_BYTES).toBe(1024 * 1024 * 1.5)
  })
})
