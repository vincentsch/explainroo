# 网站怎么安全保存密码？

## question {chapter="保存什么" transition=fade}
[#ask] 网站怎么保存密码，才更安全？[#careful] 谨慎的网站会把密码交给单向函数处理，[#hash] 保存得到的哈希值。

## example {transition=fade}
[#password] 假设你设了画面上这个密码。[#process] 网站计算它的哈希值，[#store] 存进数据库，原密码本身不会被保存。

## oneway {chapter="单向与核对" transition=fade}
[#same] 同样的输入，总会得到同样的哈希值。[#reverse] 但从哈希值倒推出原密码，在实际中不可行。[#guess] 攻击者仍然可能猜密码，再计算哈希来试。

## login {transition=fade}
[#type] 当你再次填写密码，网站会重新处理，[#new] 得到哈希结果。[#compare] 如果和保存的结果相同，密码验证就通过了。

## salt {chapter="加盐与慢计算" transition=fade}
网站会给密码[#salt] 加盐。[#random] 这里用的是一段随机数据，[#save] 和哈希结果一起保存。

## users {transition=fade}
[#shared] 两个人用了同一个密码，[#different] 加上各自不同的盐，哈希值也不同。[#table] 攻击者就没法拿一张预先算好的表，查遍所有用户。

## slow {transition=fade}
[#function] 好网站会用专门处理密码的哈希方法。[#slow] 这种方法故意算得慢，[#cost] 让每次猜测都要花更多时间。

## summary {hold=1.0 transition=fade}
[#hash] 安全保存密码，需要单向哈希，[#salt] 每个用户的随机盐，[#slow] 以及适合密码的慢计算。
