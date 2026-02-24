import { describe, expect, it } from 'bun:test';
import { createPermissionEngine } from '../src/permissions.js';

describe('Shell Permission Engine', () => {
  // -----------------------------------------------------------------------
  // Built-in safe commands
  // -----------------------------------------------------------------------

  describe('built-in safe commands', () => {
    const engine = createPermissionEngine();

    it('allows basic filesystem reading commands', () => {
      expect(engine.evaluate('ls').decision).toBe('allow');
      expect(engine.evaluate('ls -la').decision).toBe('allow');
      expect(engine.evaluate('cat /tmp/file.txt').decision).toBe('allow');
      expect(engine.evaluate('head -n 10 file.txt').decision).toBe('allow');
      expect(engine.evaluate('tail -f log.txt').decision).toBe('allow');
      expect(engine.evaluate('wc -l file.txt').decision).toBe('allow');
      expect(engine.evaluate('find . -name "*.ts"').decision).toBe('allow');
      expect(engine.evaluate('tree').decision).toBe('allow');
      expect(engine.evaluate('du -sh .').decision).toBe('allow');
      expect(engine.evaluate('df -h').decision).toBe('allow');
    });

    it('allows text processing commands', () => {
      expect(engine.evaluate('grep -r "hello" .').decision).toBe('allow');
      expect(engine.evaluate('sort file.txt').decision).toBe('allow');
      expect(engine.evaluate('uniq -c').decision).toBe('allow');
      expect(engine.evaluate('diff a.txt b.txt').decision).toBe('allow');
    });

    it('allows system info commands', () => {
      expect(engine.evaluate('echo hello').decision).toBe('allow');
      expect(engine.evaluate('pwd').decision).toBe('allow');
      expect(engine.evaluate('whoami').decision).toBe('allow');
      expect(engine.evaluate('hostname').decision).toBe('allow');
      expect(engine.evaluate('uname -a').decision).toBe('allow');
      expect(engine.evaluate('date').decision).toBe('allow');
      expect(engine.evaluate('uptime').decision).toBe('allow');
      expect(engine.evaluate('which node').decision).toBe('allow');
    });

    it('allows network diagnostics', () => {
      expect(engine.evaluate('ping -c 4 google.com').decision).toBe('allow');
      expect(engine.evaluate('curl https://example.com').decision).toBe('allow');
      expect(engine.evaluate('dig google.com').decision).toBe('allow');
    });

    it('allows process info commands', () => {
      expect(engine.evaluate('ps aux').decision).toBe('allow');
    });
  });

  // -----------------------------------------------------------------------
  // Git subcommand handling
  // -----------------------------------------------------------------------

  describe('git subcommands', () => {
    const engine = createPermissionEngine();

    it('allows read-only git subcommands', () => {
      expect(engine.evaluate('git status').decision).toBe('allow');
      expect(engine.evaluate('git log').decision).toBe('allow');
      expect(engine.evaluate('git log --oneline -10').decision).toBe('allow');
      expect(engine.evaluate('git diff').decision).toBe('allow');
      expect(engine.evaluate('git diff HEAD~1').decision).toBe('allow');
      expect(engine.evaluate('git show').decision).toBe('allow');
      expect(engine.evaluate('git branch').decision).toBe('allow');
      expect(engine.evaluate('git branch -a').decision).toBe('allow');
      expect(engine.evaluate('git tag').decision).toBe('allow');
      expect(engine.evaluate('git remote -v').decision).toBe('allow');
      expect(engine.evaluate('git blame file.ts').decision).toBe('allow');
      expect(engine.evaluate('git stash').decision).toBe('allow');
      expect(engine.evaluate('git ls-files').decision).toBe('allow');
    });

    it('requires approval for write git subcommands', () => {
      expect(engine.evaluate('git push').decision).toBe('require_approval');
      expect(engine.evaluate('git push origin main').decision).toBe('require_approval');
      expect(engine.evaluate('git commit -m "test"').decision).toBe('require_approval');
      expect(engine.evaluate('git add .').decision).toBe('require_approval');
      expect(engine.evaluate('git reset --hard').decision).toBe('require_approval');
      expect(engine.evaluate('git checkout -b feature').decision).toBe('require_approval');
      expect(engine.evaluate('git merge feature').decision).toBe('require_approval');
      expect(engine.evaluate('git rebase main').decision).toBe('require_approval');
      expect(engine.evaluate('git pull').decision).toBe('require_approval');
    });
  });

  // -----------------------------------------------------------------------
  // Runtime subcommand handling
  // -----------------------------------------------------------------------

  describe('runtime subcommands', () => {
    const engine = createPermissionEngine();

    it('allows safe npm subcommands', () => {
      expect(engine.evaluate('npm --version').decision).toBe('allow');
      expect(engine.evaluate('npm ls').decision).toBe('allow');
      expect(engine.evaluate('npm list').decision).toBe('allow');
      expect(engine.evaluate('npm outdated').decision).toBe('allow');
      expect(engine.evaluate('npm audit').decision).toBe('allow');
    });

    it('requires approval for mutating npm subcommands', () => {
      expect(engine.evaluate('npm install').decision).toBe('require_approval');
      expect(engine.evaluate('npm install lodash').decision).toBe('require_approval');
      expect(engine.evaluate('npm run build').decision).toBe('require_approval');
      expect(engine.evaluate('npm publish').decision).toBe('require_approval');
      expect(engine.evaluate('npm uninstall lodash').decision).toBe('require_approval');
    });

    it('allows safe bun subcommands', () => {
      expect(engine.evaluate('bun --version').decision).toBe('allow');
      expect(engine.evaluate('bun pm').decision).toBe('allow');
    });

    it('allows safe node subcommands', () => {
      expect(engine.evaluate('node --version').decision).toBe('allow');
      expect(engine.evaluate('node -v').decision).toBe('allow');
    });
  });

  // -----------------------------------------------------------------------
  // Dangerous patterns (always blocked)
  // -----------------------------------------------------------------------

  describe('dangerous patterns', () => {
    const engine = createPermissionEngine();

    it('blocks destructive filesystem operations', () => {
      expect(engine.evaluate('rm -rf /').decision).toBe('deny');
      expect(engine.evaluate('mkfs.ext4 /dev/sda').decision).toBe('deny');
      expect(engine.evaluate('dd if=/dev/zero of=/dev/sda').decision).toBe('deny');
    });

    it('blocks privilege escalation', () => {
      expect(engine.evaluate('sudo apt install something').decision).toBe('deny');
      expect(engine.evaluate('su root').decision).toBe('deny');
      expect(engine.evaluate('chmod 777 /tmp/file').decision).toBe('deny');
      expect(engine.evaluate('chown root:root /tmp/file').decision).toBe('deny');
    });

    it('blocks code injection', () => {
      expect(engine.evaluate('eval "rm -rf /"').decision).toBe('deny');
      expect(engine.evaluate('exec ls').decision).toBe('deny');
      expect(engine.evaluate('source ~/.bashrc').decision).toBe('deny');
      expect(engine.evaluate('cat file | sh').decision).toBe('deny');
      expect(engine.evaluate('cat file | bash').decision).toBe('deny');
      expect(engine.evaluate('cat file | zsh').decision).toBe('deny');
    });

    it('blocks system modifications', () => {
      expect(engine.evaluate('shutdown -h now').decision).toBe('deny');
      expect(engine.evaluate('reboot').decision).toBe('deny');
      expect(engine.evaluate('systemctl restart nginx').decision).toBe('deny');
    });

    it('blocks environment/credential access', () => {
      expect(engine.evaluate('export MY_SECRET=value').decision).toBe('deny');
      expect(engine.evaluate('ssh user@host').decision).toBe('deny');
      expect(engine.evaluate('cat .env').decision).toBe('deny');
    });

    it('blocks network exfiltration tools', () => {
      expect(engine.evaluate('nc -l 4444').decision).toBe('deny');
      expect(engine.evaluate('ncat -l 4444').decision).toBe('deny');
    });

    it('blocks even if command is in safe list', () => {
      // sudo is always dangerous even though the base command might be safe
      expect(engine.evaluate('sudo ls').decision).toBe('deny');
      expect(engine.evaluate('sudo cat /etc/shadow').decision).toBe('deny');
    });
  });

  // -----------------------------------------------------------------------
  // Unknown commands (require approval)
  // -----------------------------------------------------------------------

  describe('unknown commands', () => {
    const engine = createPermissionEngine();

    it('requires approval for unknown commands', () => {
      expect(engine.evaluate('make build').decision).toBe('require_approval');
      expect(engine.evaluate('docker ps').decision).toBe('require_approval');
      expect(engine.evaluate('terraform plan').decision).toBe('require_approval');
      expect(engine.evaluate('kubectl get pods').decision).toBe('require_approval');
    });
  });

  // -----------------------------------------------------------------------
  // Empty command handling
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    const engine = createPermissionEngine();

    it('denies empty commands', () => {
      expect(engine.evaluate('').decision).toBe('deny');
      expect(engine.evaluate('   ').decision).toBe('deny');
    });
  });

  // -----------------------------------------------------------------------
  // Approval system
  // -----------------------------------------------------------------------

  describe('approval system', () => {
    it('approves a command and allows it on next evaluation', () => {
      const engine = createPermissionEngine();

      expect(engine.evaluate('make build').decision).toBe('require_approval');

      engine.approve('make build');

      expect(engine.evaluate('make build').decision).toBe('allow');
    });

    it('distinguishes between session and persistent approvals', () => {
      const engine = createPermissionEngine();

      engine.approve('make build', false);
      engine.approve('make test', true);

      const approvals = engine.listApprovals();
      const buildApproval = approvals.find((a) => a.command === 'make build');
      const testApproval = approvals.find((a) => a.command === 'make test');

      expect(buildApproval?.persistent).toBe(false);
      expect(testApproval?.persistent).toBe(true);
    });

    it('clears session approvals but keeps persistent ones', () => {
      const engine = createPermissionEngine();

      engine.approve('make build', false);
      engine.approve('make test', true);
      engine.approve('make lint', false);

      const cleared = engine.clearSessionApprovals();
      expect(cleared).toBe(2);

      expect(engine.evaluate('make build').decision).toBe('require_approval');
      expect(engine.evaluate('make test').decision).toBe('allow');
      expect(engine.evaluate('make lint').decision).toBe('require_approval');
    });

    it('revokes approvals', () => {
      const engine = createPermissionEngine();

      engine.approve('make build');
      expect(engine.evaluate('make build').decision).toBe('allow');

      const revoked = engine.revoke('make build');
      expect(revoked).toBe(true);
      expect(engine.evaluate('make build').decision).toBe('require_approval');
    });

    it('returns false when revoking non-existent approval', () => {
      const engine = createPermissionEngine();

      expect(engine.revoke('make build')).toBe(false);
    });

    it('never approves dangerous commands', () => {
      const engine = createPermissionEngine();

      // Even after approval, dangerous commands should still be denied
      // (The approval is stored, but evaluate checks dangerous first)
      engine.approve('sudo rm -rf /');
      expect(engine.evaluate('sudo rm -rf /').decision).toBe('deny');
    });

    it('restores saved approvals', () => {
      const engine = createPermissionEngine(
        [],
        [
          { command: 'make build', persistent: true, approvedAt: Date.now() },
          { command: 'docker ps', persistent: false, approvedAt: Date.now() },
        ],
      );

      expect(engine.evaluate('make build').decision).toBe('allow');
      expect(engine.evaluate('docker ps').decision).toBe('allow');
    });
  });

  // -----------------------------------------------------------------------
  // User allow patterns
  // -----------------------------------------------------------------------

  describe('user allow patterns', () => {
    it('allows commands matching user patterns', () => {
      const engine = createPermissionEngine(['make *', 'docker ps']);

      expect(engine.evaluate('make build').decision).toBe('allow');
      expect(engine.evaluate('make test').decision).toBe('allow');
      expect(engine.evaluate('make lint').decision).toBe('allow');
      expect(engine.evaluate('docker ps').decision).toBe('allow');
    });

    it('does not allow partial matches without glob', () => {
      const engine = createPermissionEngine(['docker ps']);

      expect(engine.evaluate('docker ps').decision).toBe('allow');
      expect(engine.evaluate('docker run nginx').decision).toBe('require_approval');
    });

    it('dynamically adds and removes patterns', () => {
      const engine = createPermissionEngine();

      expect(engine.evaluate('make build').decision).toBe('require_approval');

      engine.addAllowPattern('make *');
      expect(engine.evaluate('make build').decision).toBe('allow');

      const removed = engine.removeAllowPattern('make *');
      expect(removed).toBe(true);
      expect(engine.evaluate('make build').decision).toBe('require_approval');
    });

    it('lists current patterns', () => {
      const engine = createPermissionEngine(['make *', 'docker ps']);
      engine.addAllowPattern('cargo build');

      const patterns = engine.listAllowPatterns();
      expect(patterns).toContain('make *');
      expect(patterns).toContain('docker ps');
      expect(patterns).toContain('cargo build');
    });

    it('blocks dangerous commands even if in allow patterns', () => {
      const engine = createPermissionEngine(['sudo *']);

      // Even with a pattern that matches, dangerous patterns take priority
      expect(engine.evaluate('sudo rm -rf /').decision).toBe('deny');
    });
  });

  // -----------------------------------------------------------------------
  // Decision reasons
  // -----------------------------------------------------------------------

  describe('decision reasons', () => {
    const engine = createPermissionEngine();

    it('includes matched rule for safe commands', () => {
      const result = engine.evaluate('ls -la');
      expect(result.matchedRule).toContain('builtin:');
    });

    it('includes reason for blocked commands', () => {
      const result = engine.evaluate('sudo apt install something');
      expect(result.reason).toContain('Blocked');
    });

    it('includes matched rule for git subcommands', () => {
      const readResult = engine.evaluate('git status');
      expect(readResult.matchedRule).toContain('git.');

      const writeResult = engine.evaluate('git push');
      expect(writeResult.matchedRule).toContain('git:write');
    });
  });
});
