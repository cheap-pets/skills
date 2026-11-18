module.exports = {
  types: [
    { value: '✨', name: '✨  新增:  新建 skill / 新增文件' },
    { value: '📝', name: '📝  修订:  修订已有文档内容' },
    { value: '🐛', name: '🐛  修复:  修复文档中的错误' },
    { value: '♻️', name: '♻️  重构:  文档/脚本结构重构' },
    { value: '✏️', name: '✏️  格式:  格式与文字微调' },
    { value: '🔧', name: '🔧  配置:  构建/配置调整' }
  ],

  subjectLimit: 80,
  skipQuestions: ['scope', 'body', 'breaking', 'footer'],

  allowCustomScopes: false
}
