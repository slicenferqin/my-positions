
import subprocess
import sys
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/api/ai/analyze', methods=['POST'])
def analyze():
    try:
        data = request.json
        if not data or 'prompt' not in data:
            return jsonify({'error': 'Missing prompt'}), 400

        prompt = data['prompt']
        
        # 调用本地 claude cli
        # 假设命令是 `claude "prompt"` 或者通过 stdin 传递
        # 这里使用 stdin 传递以支持长文本，并假设 cli 名称为 `claude`
        # 用户可能需要根据实际情况调整命令，例如 `claude -p` 等
        
        # 尝试通过管道传递给 claude
        # 相当于: echo "prompt" | claude
        process = subprocess.Popen(
            ['claude'], 
            stdin=subprocess.PIPE, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE,
            text=True,
            shell=True # 使用 shell 执行以确保能够找到环境变量中的 claude
        )
        
        stdout, stderr = process.communicate(input=prompt)
        
        if process.returncode != 0:
            return jsonify({'error': f'Claude CLI failed: {stderr}'}), 500
            
        return jsonify({'result': stdout})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("Starting AI Proxy Server on port 5000...")
    print("Please ensure 'claude' CLI is installed and authenticated in your terminal.")
    app.run(port=5000, debug=True)
