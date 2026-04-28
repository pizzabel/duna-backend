import { Module }         from '@nestjs/common';
import { JwtModule }      from '@nestjs/jwt';
import { ConfigModule, ConfigService }  from '@nestjs/config';
import { ChatGateway }    from './chat.gateway';
import { ChatController } from './chat.controller';
import { ChatService }    from './chat.service';
import { AntifraudModule } from '../antifraud/antifraud.module';

@Module({
  imports: [
    ConfigModule,
    AntifraudModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject:  [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret:       cfg.getOrThrow('JWT_SECRET'),
        signOptions:  { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [ChatController],
  providers:   [ChatGateway, ChatService],
  exports:     [ChatService],
})
export class ChatModule {}
