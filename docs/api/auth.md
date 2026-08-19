（适配desktop）登录

简要描述
用户登录接口，user 与 ams 均支持密码登录和验证码登录。
login_type 为空时按 password 处理。
密码登录时按 工号 > 手机号 > 邮箱 定位唯一账号；任一匹配字段命中多用户会拒绝登录。
验证码登录时 username 仅支持手机号或邮箱，并根据格式自动判断渠道（手机号→短信，邮箱→邮件）。
必须同时传入 user_type 与 client_type，且二者必须是合法组合。
请求URL
/passport/login
请求方式
POST
请求参数
{
    "user_type": "user",       // 必填-用户类型，如 user / ams
    "client_type": "app",       // 必填-客户端类型：ams / app / desktop
    "username": "13800138000", // 必填-登录账号；密码登录支持工号/手机号/邮箱，验证码登录仅支持手机号/邮箱
    "login_type": "valid_code",  // 登录方式：password-密码登录，valid_code-验证码登录；为空时按 password
    "password": "Abc12345",    // 密码登录时必填
    "valid_code": "123456"     // 验证码登录时必填
}
规则说明
场景	规则
密码登录	按工号、手机号、邮箱顺序查找唯一账号
验证码登录	username 必须是手机号或邮箱
ams 登录	账号必须是管理员账号
空密码账号	返回账号未设置密码提示，不按账号密码错误处理
重复数据	本次匹配字段命中多用户时拒绝登录，并由服务记录日志供维护排查
user_type 与 client_type 的合法组合仅如下表：

user_type	client_type
ams	ams
user	app
user	desktop
登录成功后，访问令牌和刷新令牌都包含 client_type Token claim。HTTP 响应 data 和 Token 的 attach 不重复增加 user_type 或 client_type。

返回数据
{
    "code": 200,
    "message": "success",
    "data": {
        "registered": true,              // 用户是否已注册
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", // 访问令牌
        "expire": 1749340800,            // 访问令牌过期时间（Unix 时间戳）
        "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", // 刷新令牌
        "refresh_token_expire": 1751932800, // 刷新令牌过期时间（Unix 时间戳）
        "attach": {}                     // 附加信息（可选）
    }
}
简要描述
用户登录接口，user 与 ams 均支持密码登录和验证码登录。
login_type 为空时按 password 处理。
密码登录时按 工号 > 手机号 > 邮箱 定位唯一账号；任一匹配字段命中多用户会拒绝登录。
验证码登录时 username 仅支持手机号或邮箱，并根据格式自动判断渠道（手机号→短信，邮箱→邮件）。
必须同时传入 user_type 与 client_type，且二者必须是合法组合。
请求URL
/passport/login
请求方式
POST
请求参数
{
    "user_type": "user",       // 必填-用户类型，如 user / ams
    "client_type": "app",       // 必填-客户端类型：ams / app / desktop
    "username": "13800138000", // 必填-登录账号；密码登录支持工号/手机号/邮箱，验证码登录仅支持手机号/邮箱
    "login_type": "valid_code",  // 登录方式：password-密码登录，valid_code-验证码登录；为空时按 password
    "password": "Abc12345",    // 密码登录时必填
    "valid_code": "123456"     // 验证码登录时必填
}
规则说明
场景	规则
密码登录	按工号、手机号、邮箱顺序查找唯一账号
验证码登录	username 必须是手机号或邮箱
ams 登录	账号必须是管理员账号
空密码账号	返回账号未设置密码提示，不按账号密码错误处理
重复数据	本次匹配字段命中多用户时拒绝登录，并由服务记录日志供维护排查
user_type 与 client_type 的合法组合仅如下表：

user_type	client_type
ams	ams
user	app
user	desktop
登录成功后，访问令牌和刷新令牌都包含 client_type Token claim。HTTP 响应 data 和 Token 的 attach 不重复增加 user_type 或 client_type。

返回数据
{
    "code": 200,
    "message": "success",
    "data": {
        "registered": true,              // 用户是否已注册
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", // 访问令牌
        "expire": 1749340800,            // 访问令牌过期时间（Unix 时间戳）
        "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", // 刷新令牌
        "refresh_token_expire": 1751932800, // 刷新令牌过期时间（Unix 时间戳）
        "attach": {}                     // 附加信息（可选）
    }
}

（适配desktop）刷新令牌
简要描述
刷新访问令牌接口，当访问令牌过期后使用刷新令牌获取新的令牌对
请求URL
/passport/refresh_token
请求方式
POST
请求参数
{
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." // 必填-刷新令牌
}
规则说明
client_type 从已签名的 Refresh Token 中读取，并由新生成的访问令牌和刷新令牌继承。
请求体不能覆盖 client_type。
Refresh Token 中的 client_type 枚举值非法，或与 user_type 的组合非法时，该 Refresh Token 无效。
返回数据
{
    "code": 200,
    "message": "success",
    "data": {
        "registered": true,              // 用户是否已注册
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", // 新的访问令牌
        "expire": 1749340800,            // 访问令牌过期时间（Unix 时间戳）
        "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", // 新的刷新令牌
        "refresh_token_expire": 1751932800, // 刷新令牌过期时间（Unix 时间戳）
        "attach": {}                     // 附加信息（可选）
    }
}

登出
简要描述
用户注销登录接口，注销后访问令牌和刷新令牌将失效
请求URL
/passport/logout
请求方式
POST
请求参数
Header	值	说明
Authorization	Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…	必填-访问令牌，需带 Bearer 前缀
UserType	user	可选-用户类型（user / ams），若不传则自动从 token 解析
返回数据
{
    "code": 200,
    "message": "success",
    "data": {}
}

(适配desktop)发送验证码
简要描述
发送验证码接口，支持短信（SMS）和邮件（Email）两种渠道。
login 与 forget_password 场景下，account 只支持手机号或邮箱，并会校验账号唯一、启用；ams 场景还会校验管理员身份。
验证码按 user_type:client_type:biz_type 逻辑 scope 隔离。
请求URL
/passport/valid_code/send
请求方式
POST
请求参数
{
    "user_type": "user",       // 可选-用户类型：user / ams；默认 user
    "client_type": "app",       // 必填-客户端类型：ams / app / desktop
    "channel": "sms",          // 必填-发送渠道：sms-短信，email-邮件
    "account": "13800138000",  // 必填-接收账号（手机号或邮箱地址）
    "biz_type": "login",       // 必填-业务类型，如 login / forget_password / register
    "subject": ""              // 邮件主题（channel 为 email 时可填）
}
规则说明
字段	规则
user_type	可选，未传按 user；后台管理验证码传 ams
client_type	必填：ams / app / desktop；必须与 user_type 组成合法组合
channel	sms 要求 account 是手机号；email 要求 account 是邮箱
account	login / forget_password 只支持手机号或邮箱，不支持工号
biz_type	必填，不限制枚举；login / forget_password 会先校验账号唯一、启用和管理员身份；其它业务类型保持直发能力
验证码缓存 key 的完整格式如下：

{app_name}:valid_code:{kind}:{channel}:{user_type}:{client_type}:{biz_type}:{account}
{main.key_prefix}:{app_name}:valid_code:{kind}:{channel}:{user_type}:{client_type}:{biz_type}:{account}
对于相同的 channel、biz_type 和 account，App、Desktop 和 AMS 分别拥有独立的 5 次发送额度。

返回数据
{
    "code": 200,
    "message": "success",
    "data": {}
}

（适配desktop）重置密码
简要描述
通过短信或邮箱验证码重置密码，无需登录态。
user 与 ams 均支持；ams 场景会校验账号是管理员。
account 只支持手机号或邮箱，不支持工号。
请求URL
/passport/password/reset
请求方式
POST
请求参数
{
    "user_type": "user",
    "client_type": "app",
    "account": "13800138000",
    "channel": "sms",
    "valid_code": "123456",
    "new_password": "Abc12345",
    "confirm_password": "Abc12345"
}
参数名	必选	类型	说明
user_type	否	string	用户类型：user / ams，默认 user
client_type	是	string	客户端类型：ams / app / desktop；必须与 user_type 组成合法组合
account	是	string	手机号或邮箱地址
channel	是	string	sms / email，必须与 account 类型匹配
valid_code	是	string	forget_password 场景下发送的验证码
new_password	是	string	新密码，至少 6 个字符，并且必须同时包含字母和数字
confirm_password	是	string	确认新密码，必须与 new_password 一致
规则说明
场景	规则
手机号/邮箱重复	拒绝重置，并记录日志供维护人员排查
账号禁用	拒绝重置
ams	账号必须是管理员
验证码 scope	发送验证码和重置密码必须使用完全相同的 UserType、ClientType、Channel、Account 与 forget_password BizType
只有工号无手机号邮箱	无法通过该接口自助重置，请联系管理员处理
返回示例
{
    "code": 200,
    "message": "success",
    "data": {},
    "trace_id": "trace-id"
}