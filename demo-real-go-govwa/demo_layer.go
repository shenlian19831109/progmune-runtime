// 演示层（非 govwa 代码）——A 路径守卫演示
//
// govwa 真实原语已注解（user.go::loginAction=verify、session.go::
// SetSession=establish、middleware.go::AuthCheck=guard）。
// 演示层以同形调用表达守卫语义：合法流（verify→establish→guard）
// 与植入违规（未登录直接过守卫——经典 missing-auth）。

package main

// 合法流：凭证比对 → 会话建立 → 鉴权守卫
func govwaGoodFlow(w string, r string, data map[string]string) bool {
	if loginAction(nil, nil, nil) {
		s := newSession()
		s.SetSession(nil, nil, data)
		auth := newAuth()
		auth.AuthCheck(nil)
		return true
	}
	return false
}

// 植入违规：未登录直接过鉴权守卫（missing-auth）
func govwaNoAuthFlow() {
	auth := newAuth()
	auth.AuthCheck(nil)
}

// 占位类型（演示层不自包含真实依赖——扫描只取调用名）
type sessionStub struct{}

func newSession() *sessionStub { return &sessionStub{} }

type authStub struct{}

func newAuth() *authStub { return &authStub{} }
