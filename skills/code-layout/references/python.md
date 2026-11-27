# Python 特例

以 black / ruff format / PEP 8 为准，与主规则冲突时服从它们。

- 顶层函数、类之间空 2 行；类内方法之间空 1 行。（数量由 formatter 管，不按主规则的“1 行”）
- 装饰器紧贴被装饰的定义，不空行。
- 模块 docstring、类 docstring 之后空 1 行；函数 docstring 之后不空行。
- `if __name__ == "__main__":` 与上方代码之间按顶层规则空 2 行。
- dataclass / 类属性的字段连写；字段与第一个方法之间空 1 行。
