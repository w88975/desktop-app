获取模型服务配置信息
简要描述
登录用户获取客户端调用 OpenAI 兼容接口所需的 base_url、共享渠道 api_key 和可用模型 public_id 字符串。
api_key 由 user 服务的 GetOrCreateOpenAIApiKey 内部 RPC 获取，不是 AIADP 平台 workspace Key。
请求URL
'/ai-service/api/model_center/openai/config'
请求方式
POST
认证
接口必须通过平台网关登录鉴权。网关向 ai-service 注入合法的 X-User-Id；缺失或格式错误时接口返回业务码 400，不会获取或返回 API Key。

请求参数
{}
参数	类型	必填	说明
无	-	-	请求体为空 JSON 对象。
返回数据
{
    "code": 200,
    "message": "success",
    "data": {
        "base_url": "https://gateway.example.com/compatible-mode",
        "api_key": "sk-example",
        "model_public_ids": "provider/model-a,provider/model-b"
    },
    "trace_id": "..."
}
返回参数
参数	类型	必返	说明
code	int	是	业务状态码，成功为 200。
message	string	是	结果说明。
data.base_url	string	成功时是	APP_DOMAIN 去除末尾 / 后拼接 /compatible-mode。
data.api_key	string	成功时是	user 服务维护的 OpenAI 兼容接口共享渠道 Key。
data.model_public_ids	string	成功时是	可用模型的 public_id，使用英文逗号连接且逗号后无空格；没有可用模型时为 ""。
trace_id	string	是	请求追踪 ID。
模型顺序与用户端可用模型列表一致：默认模型及其厂商优先，其余按现有模型中心排序规则排列。接口不会返回 user 服务的 api_key_id，也不会返回 AIADP 平台 workspace Key。

错误响应
接口始终返回 HTTP 200，业务结果由响应体承载：

code	场景
400	缺少合法的登录用户 ID。
500	APP_DOMAIN 未配置、user 服务 RPC 失败、共享 Key 为空或模型查询失败。
api_key 属于敏感凭证。客户端不得把它写入日志、埋点或错误上报；服务端同样不会把 Key 写入普通日志、错误信息或链路追踪属性。