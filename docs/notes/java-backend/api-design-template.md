# 接口设计模板

这页模板适合拿来写每一个后端接口的设计说明。

## 接口基本信息

- 接口名称：
- 请求路径：
- 请求方法：
- 功能说明：
- 调用方：

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| id | Long | 是 | 示例字段 |

## 返回数据

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| code | Integer | 返回码 |
| message | String | 提示信息 |
| data | Object | 业务数据 |

## 业务规则

- 参数校验规则：
- 幂等要求：
- 权限要求：
- 异常场景：

## 示例

### 请求示例

```http
POST /api/example
Content-Type: application/json
```

### 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1
  }
}
```

## 关联实现

- Controller：
- Service：
- Repository / Mapper：
- 数据表：
