# JavaScript: callbacks to async/await

## intro {chapter="Callbacks"}
[#question] How does JavaScript handle two requests that [#depends] depend on each other? Our helper functions [#user] fetch a user, then [#orders] that user's orders, and [#display] display them.

## callbacks {transition=cut}
[#callback] Here, a callback is a function that [#later] runs after a result arrives. [#nested] When the user arrives, its callback starts fetching orders. [#display] Another callback displays them.

## promises {chapter="Promises" transition=cut}
[#promise] Now use helpers that return promises, which represent [#future] future results. A then handler [#then] receives the user, and [#return] returns the promise for their orders.

## chain {transition=cut}
[#wait] Returning that promise makes the next handler [#orders] wait for the orders. A [#catch] catch handler handles failures from [#either] either request.

## asyncVersion {chapter="Async and await" transition=cut}
[#async] The {async|a sink} keyword lets a function use [#syntax] {await|a wait} expressions. Each [#first] {await|a wait} gives us the result when its [#second] promise succeeds.

## waiting {transition=cut}
[#pause] While this function is waiting, [#other] other JavaScript can keep running. A rejected promise [#throws] makes this function throw, so [#try] try and catch handle failures.

## summary {hold=1.1 transition=fade}
[#callbacks] Callbacks nest the steps, and [#promises] promises connect them through handlers. [#await] The {async|a sink} and {await|a wait} keywords make promise based code [#read] easier to read.
