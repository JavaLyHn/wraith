package com.lyhn.wraith.runtime.appserver;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/** mcp.* RPC 的操作面(spec §4)。AppServer handler 只见此接口,便于 dispatch 测试用匿名 fake。 */
public interface McpOps {
    /** {servers:[{name,state,scope,enabled,shadowed,transport,tools,envKeys,error?}], configError?} */
    Map<String, Object> list();
    void enable(String name);
    void disable(String name);
    void restart(String name);
    String logs(String name);
    /** name 为 null = 全部 server 汇总(@ 补全数据源);元素 {server,uri,name,description?} */
    List<Map<String, Object>> resources(String nameOrNull);
    /** 引擎格式化文本(spec:{text}) */
    String prompts(String name);
    void configUpsert(String scope, String name, String command, List<String> args, Map<String, String> env) throws IOException;
    boolean configRemove(String scope, String name) throws IOException;
}
