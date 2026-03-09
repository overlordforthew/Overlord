Container Inventory  
20 containers  
Project | App Container | DB Container | Network | Port  
Overlord | overlord | mastercommander-db | coolify | 127.0.0.1:3001  
SurfaBabe | surfababe | surfababe-db | coolify | 127.0.0.1:3002  
MasterCommander | mastercommander | mastercommander-db | coolify | 127.0.0.1:3010  
NamiBarden | namibarden | namibarden-db | standalone | 80 internal  
Lumina | lumina-app | lumina-db | okw0cwwgskcow8k8o08gsok0 | 3456 internal  
OnlyHulls | coolify | coolify-db+coolify-redis | coolify | 127.0.0.1:5433/7701/6380  
Elmo | coolify | None | coolify | 80 internal  
Coolify | coolify+coolify-realtime+coolify-sentinel+coolify-proxy | coolify-db (PG15)+coolify-redis | coolify | 127.0.0.1:8000 / 443  

Databases  
MasterCommander: mastercommander-db  
SurfaBabe: surfababe-db  
MasterCommander: mastercommander-db  
NamiBarden: namibarden-db (Traefik-lab)  
Lumina: lumina-db  
OnlyHulls: onlyhulls-db  
Networks  
coolify – main network  
okw0cwwgskcow8k8o08gsok0 – Lumina HT  
ssc: service: coolify-db (PG17) + redis  
main-network - OnlyHulls-Services
