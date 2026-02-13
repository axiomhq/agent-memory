{
  description = "agent-memory: standalone memory system for AI coding agents";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    bun.url = "github:lytedev/bun-flake";
  };

  outputs = { self, nixpkgs, bun }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      pkgsFor = system: import nixpkgs {
        inherit system;
        config.allowUnfree = true;
      };
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.stdenv.mkDerivation {
            pname = "agent-memory";
            version = "0.1.0";

            src = ./.;

            nativeBuildInputs = [ pkgs.makeWrapper ];

            buildInputs = [ bun.packages.${system}.default ];

            buildPhase = ''
              export HOME=$TMPDIR
              bun install --frozen-lockfile
              bun build ./src/cli/index.ts --compile --outfile memory
            '';

            installPhase = ''
              mkdir -p $out/bin
              cp memory $out/bin/memory
              chmod +x $out/bin/memory
            '';
          };
        });

      devShells = forAllSystems (system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            buildInputs = with pkgs; [
              bun.packages.${system}.default
              nodePackages.typescript
              oxlint
            ];
          };
        });

      overlays.default = final: prev: {
        agent-memory = self.packages.${final.system}.default;
      };

      darwinModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.agent-memory;
        in
        {
          options.services.agent-memory = {
            enable = lib.mkEnableOption "agent-memory consolidation and defrag";

            user = lib.mkOption {
              type = lib.types.str;
              default = "root";
              description = "User to run agent-memory as";
            };

            consolidateInterval = lib.mkOption {
              type = lib.types.int;
              default = 7200;
              description = "Interval in seconds between consolidation runs";
            };

            defragInterval = lib.mkOption {
              type = lib.types.int;
              default = 86400;
              description = "Interval in seconds between defrag runs";
            };
          };

          config = lib.mkIf cfg.enable {
            environment.systemPackages = [ self.packages.${pkgs.system}.default ];

            launchd.daemons.agent-memory-consolidate = {
              command = "${self.packages.${pkgs.system}.default}/bin/memory consolidate";
              serviceConfig = {
                UserName = cfg.user;
                StartInterval = cfg.consolidateInterval;
                StandardOutPath = "/var/log/agent-memory-consolidate.log";
                StandardErrorPath = "/var/log/agent-memory-consolidate.log";
              };
            };

            launchd.daemons.agent-memory-defrag = {
              command = "${self.packages.${pkgs.system}.default}/bin/memory defrag";
              serviceConfig = {
                UserName = cfg.user;
                StartInterval = cfg.defragInterval;
                StandardOutPath = "/var/log/agent-memory-defrag.log";
                StandardErrorPath = "/var/log/agent-memory-defrag.log";
              };
            };
          };
        };

      nixosModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.agent-memory;
        in
        {
          options.services.agent-memory = {
            enable = lib.mkEnableOption "agent-memory consolidation and defrag";

            user = lib.mkOption {
              type = lib.types.str;
              default = "root";
              description = "User to run agent-memory as";
            };

            consolidateInterval = lib.mkOption {
              type = lib.types.str;
              default = "*:0/2";
              description = "Systemd timer OnCalendar for consolidation";
            };

            defragInterval = lib.mkOption {
              type = lib.types.str;
              default = "daily";
              description = "Systemd timer OnCalendar for defrag";
            };
          };

          config = lib.mkIf cfg.enable {
            environment.systemPackages = [ self.packages.${pkgs.system}.default ];

            systemd.services.agent-memory-consolidate = {
              description = "Agent Memory Consolidation";
              serviceConfig = {
                Type = "oneshot";
                User = cfg.user;
                ExecStart = "${self.packages.${pkgs.system}.default}/bin/memory consolidate";
              };
            };

            systemd.timers.agent-memory-consolidate = {
              description = "Agent Memory Consolidation Timer";
              wantedBy = [ "timers.target" ];
              timerConfig = {
                OnCalendar = cfg.consolidateInterval;
                Persistent = true;
              };
            };

            systemd.services.agent-memory-defrag = {
              description = "Agent Memory Defrag";
              serviceConfig = {
                Type = "oneshot";
                User = cfg.user;
                ExecStart = "${self.packages.${pkgs.system}.default}/bin/memory defrag";
              };
            };

            systemd.timers.agent-memory-defrag = {
              description = "Agent Memory Defrag Timer";
              wantedBy = [ "timers.target" ];
              timerConfig = {
                OnCalendar = cfg.defragInterval;
                Persistent = true;
              };
            };
          };
        };
    };
}
