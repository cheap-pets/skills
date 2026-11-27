# Vue 单文件组件特例

本文在主规则基础上补充 Vue SFC 的分段约定；主规则中的**多行语句块前后空 1 行**及**解构与普通赋值间空 1 行**依然生效。

- `<template>`、`<script>`、`<style>` 三个顶层块之间空 1 行；块内首尾不空行。
- `<script setup>` 内按类别分段，同类单行语句连写、异类之间空 1 行；同一类别内的多行语句块（如多行 `computed`、`watch`、函数、生命周期钩子）之间仍空 1 行。常见类别：import、`defineProps` / `defineEmits` / `defineModel`、store 与 composable 调用、响应式状态（`ref` / `reactive`）、`computed`、方法、`watch`、生命周期钩子。顺序以项目约定为准，本文只要求同类聚在一起。
- `<template>` 内兄弟元素默认连写；功能区域之间（如筛选区、表格、分页）可空 1 行。
- `<style>` 内规则之间空 1 行。
