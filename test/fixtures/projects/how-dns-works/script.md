# How DNS finds a website

> A classic explainer in the chalk look. The diagram grows from scene to
> scene: earlier parts are carried over with at: -1.

## hook
You type {example.com|example dot com}, and a page appears. [#but] Computers don't find each other by name, though. [#numbers] They use numbers called IP addresses.

## question
So before the page can load, [#ask] your browser needs the IP address of {example.com|example dot com}.

## cache
First it checks if it already knows the answer. [#browser] The browser [#os] and your operating system both keep recent answers in a cache.

## resolver
If neither of them knows it, the browser asks a resolver. [#isp] Your internet provider usually runs one, [#public] and there are public ones like {1.1.1.1|one dot one dot one dot one}.

## root
The resolver starts with a root server. [#root] The root server doesn't know the address, [#tld] but it knows where the dot com servers are.

## tld
The dot com servers don't know it either. [#auth] They send the resolver to the name server of {example.com|example dot com}.

## answer
That name server has the answer. [#ip] It sends the IP address back, [#keep] and the resolver saves it for the next time someone asks.

## outro {hold=1.5}
That makes four questions to find one address. [#blink] It usually takes a fraction of a second.
