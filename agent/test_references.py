from agent.main import conversation_history, TOOLS, SYSTEM

def test_references_remain_data_in_user_message():
    history = conversation_history([{"role":"user","text":"修改钩子","contextRefs":[{"resourceId":"selected-id","title":"选中的创意","version":3,"content":{"hook":"旧钩子"}}]}])
    assert history[0]["role"] == "user"
    assert "selected-id" in history[0]["content"]
    assert "旧钩子" in history[0]["content"]
    assert "修改钩子" in history[0]["content"]

def test_direct_generation_tool_is_available_without_channel_selection():
    tool = next(t["function"] for t in TOOLS if t["function"]["name"] == "generate_media")
    assert tool["parameters"]["required"] == ["kind","productId","prompt"]
    assert "不询问渠道" in SYSTEM
    assert "不能自我批准" in SYSTEM
